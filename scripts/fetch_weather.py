"""Fetch a complete Baidu weather snapshot without exposing credentials."""

import json
import math
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


LOCATIONS = json.loads((Path(__file__).resolve().parents[1] / "assets/data/weather-locations.json").read_text(encoding="utf-8"))
CITIES = tuple((city["weatherKey"], city["name"], city["districtId"]) for city in LOCATIONS)
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "weather.json"
MAX_ATTEMPTS = 3


class WeatherError(Exception):
    """A safe error message that never contains the request URL or API key."""


def validate_result(result, district_id):
    if not isinstance(result, dict):
        raise WeatherError("响应缺少天气 result")
    location = result.get("location", result.get("address"))
    if not isinstance(location, dict) or str(location.get("id")) != district_id:
        raise WeatherError("响应地区与请求地区不匹配")
    now = result.get("now")
    if not isinstance(now, dict):
        raise WeatherError("响应缺少实时天气")
    temp = now.get("temp")
    if isinstance(temp, bool) or not isinstance(temp, (int, float)) or not math.isfinite(temp) or temp == 999999:
        raise WeatherError("响应缺少有效实时温度")
    try:
        datetime.strptime(now["uptime"], "%Y%m%d%H%M%S")
    except (KeyError, TypeError, ValueError):
        raise WeatherError("响应缺少有效天气更新时间") from None
    forecasts = result.get("forecasts")
    if not isinstance(forecasts, list) or not forecasts:
        raise WeatherError("响应缺少天气预报")
    for row in forecasts:
        try:
            datetime.strptime(row["date"], "%Y-%m-%d")
        except (KeyError, TypeError, ValueError):
            raise WeatherError("响应预报日期无效") from None
    return result


def fetch_city(ak, district_id):
    query = urlencode({"district_id": district_id, "data_type": "all", "output": "json", "ak": ak})
    request = Request("https://api.map.baidu.com/weather/v1/?" + query)
    for attempt in range(MAX_ATTEMPTS):
        retry = False
        try:
            with urlopen(request, timeout=30) as response:
                payload = json.load(response)
        except HTTPError as error:
            if error.code == 429 or 500 <= error.code < 600:
                retry = True
            else:
                raise WeatherError(f"HTTP 请求失败（{error.code}），请检查 AK、权限和参数") from None
        except (URLError, TimeoutError, OSError):
            retry = True
        except (ValueError, UnicodeError):
            raise WeatherError("接口返回无效 JSON") from None
        else:
            if not isinstance(payload, dict):
                raise WeatherError("接口返回无效对象")
            status = payload.get("status")
            if status in (429, 500, 503):
                retry = True
            elif type(status) is not int or status != 0:
                # Do not print upstream messages: they may echo the credential.
                raise WeatherError("百度业务请求失败，请检查 AK、天气权限、白名单和地区代码")
            else:
                return validate_result(payload.get("result"), district_id)
        if retry and attempt + 1 < MAX_ATTEMPTS:
            time.sleep(2 ** (attempt + 1))
    raise WeatherError("网络或服务暂不可用，三次尝试均失败")


def collect(ak):
    cities = {}
    for key, name, district_id in CITIES:
        try:
            result = fetch_city(ak, district_id)
        except WeatherError as error:
            raise WeatherError(f"{name}：{error}") from None
        cities[key] = {"name": name, "districtId": district_id, "result": result}
    return {
        "schemaVersion": 1,
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "cities": cities,
    }


def write_snapshot(snapshot, output=OUTPUT):
    output = Path(output)
    # Preserve the last successful collection time when upstream data is unchanged.
    try:
        previous = json.loads(output.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError, UnicodeError):
        previous = None
    if isinstance(previous, dict) and previous.get("schemaVersion") == 1 and previous.get("cities") == snapshot["cities"]:
        return False
    encoded = json.dumps(snapshot, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n", dir=output.parent, delete=False) as file:
            temporary = Path(file.name)
            file.write(encoded)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return True


def main():
    ak = os.environ.get("BAIDU_MAP_AK", "").strip()
    if not ak:
        print("天气采集失败：请配置 Secret BAIDU_MAP_AK", file=sys.stderr)
        return 1
    try:
        changed = write_snapshot(collect(ak), OUTPUT)
    except WeatherError as error:
        print(f"天气采集失败：{error}；旧文件保持不变", file=sys.stderr)
        return 1
    except (OSError, ValueError):
        print("天气采集失败：无法保存有效快照；旧文件保持不变", file=sys.stderr)
        return 1
    print(f"{len(CITIES)}城市天气已更新" if changed else "天气数据未变化，保留上次快照")
    return 0


if __name__ == "__main__":
    sys.exit(main())
