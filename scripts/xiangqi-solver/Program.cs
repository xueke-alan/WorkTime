// Offline exact AND/OR search; input: position|max-red-moves|node-budget.
// Certificates choose a winning red continuation and include ALL legal black replies.
using System.Text.Json;

static class Solver
{
    static bool Palace(int s, bool red) => s % 9 >= 3 && s % 9 <= 5 && (red ? s / 9 >= 7 : s / 9 <= 2);
    static bool Reaches(sbyte[] b, int f, int t)
    {
        int dx = t % 9 - f % 9, dy = t / 9 - f / 9, ax = Math.Abs(dx), ay = Math.Abs(dy);
        bool red = b[f] > 0;
        switch (Math.Abs(b[f]))
        {
            case 1: return ax + ay == 1 && Palace(t, red);
            case 2: return ax == 1 && ay == 1 && Palace(t, red);
            case 3: return ax == 2 && ay == 2 && (red ? t / 9 >= 5 : t / 9 <= 4) && b[(f + t) / 2] == 0;
            case 4: return ax * ay == 2 && b[f + (ax == 2 ? Math.Sign(dx) : 9 * Math.Sign(dy))] == 0;
            case 5:
            case 6:
                if ((ax != 0 && ay != 0) || f == t) return false;
                int step = ax == 0 ? 9 * Math.Sign(dy) : Math.Sign(dx), count = 0;
                for (int s = f + step; s != t; s += step) if (b[s] != 0) count++;
                return count == (Math.Abs(b[f]) == 6 && b[t] != 0 ? 1 : 0);
            case 7: return (ax == 0 && dy == (red ? -1 : 1)) || (ay == 0 && ax == 1 && (red ? f / 9 < 5 : f / 9 > 4));
            default: return false;
        }
    }
    static bool Checked(sbyte[] b, bool red)
    {
        int k = Array.IndexOf(b, (sbyte)(red ? 1 : -1));
        int other = Array.IndexOf(b, (sbyte)(red ? -1 : 1));
        if (k % 9 == other % 9)
        {
            bool facing = true;
            for (int s = Math.Min(k, other) + 9; s < Math.Max(k, other); s += 9) if (b[s] != 0) { facing = false; break; }
            if (facing) return true;
        }
        for (int f = 0; f < 90; f++) if (b[f] != 0 && (b[f] > 0) != red && Reaches(b, f, k)) return true;
        return false;
    }
    static sbyte[] Apply(sbyte[] b, int move)
    {
        var a = (sbyte[])b.Clone(); a[move % 90] = a[move / 90]; a[move / 90] = 0; return a;
    }
    static readonly (int, int)[][] Offsets = [[], [(0,-1),(0,1),(-1,0),(1,0)], [(-1,-1),(-1,1),(1,-1),(1,1)], [(-2,-2),(-2,2),(2,-2),(2,2)], [(-2,-1),(-2,1),(2,-1),(2,1),(-1,-2),(-1,2),(1,-2),(1,2)]];
    static List<int> Moves(sbyte[] b, bool red)
    {
        var result = new List<int>(48);
        for (int f = 0; f < 90; f++)
        {
            int p = Math.Abs(b[f]);
            if (p == 0 || (b[f] > 0) != red) continue;
            void Add(int t)
            {
                if (t == f || (b[t] != 0 && ((b[t] > 0) == red || Math.Abs(b[t]) == 1)) || !Reaches(b, f, t)) return;
                int move = f * 90 + t;
                // Make/unmake avoids allocating boards for rejected pseudo moves.
                sbyte captured = b[t]; b[t] = b[f]; b[f] = 0;
                bool legal = !Checked(b, red);
                b[f] = b[t]; b[t] = captured;
                if (legal) result.Add(move);
            }
            if (p == 5 || p == 6)
            {
                for (int t = f % 9; t < 90; t += 9) Add(t);
                for (int t = f / 9 * 9; t < f / 9 * 9 + 9; t++) Add(t);
            }
            else foreach (var (dx, dy) in Offsets[p == 7 ? 1 : p])
            {
                int x = f % 9 + dx, y = f / 9 + dy;
                if (x >= 0 && x < 9 && y >= 0 && y < 10) Add(y * 9 + x);
            }
        }
        return result;
    }
    // Exact board keys avoid treating a hash collision as a proof.
    readonly record struct Key(ulong A, ulong B, ulong C, ulong D, ulong E, ulong F, bool Red);
    static Key BoardKey(sbyte[] b, bool red)
    {
        Span<ulong> a = stackalloc ulong[6];
        a.Clear();
        for (int s = 0; s < 90; s++) a[s / 16] |= (ulong)(b[s] + 7) << (s % 16 * 4);
        return new Key(a[0], a[1], a[2], a[3], a[4], a[5], red);
    }
    readonly record struct Entry(int Lower, int Upper, int Best);
    sealed class LimitException : Exception { }
    sealed class Search(long limit)
    {
        readonly Dictionary<Key, Entry> table = [];
        public long Nodes;
        public bool Win(sbyte[] b, bool red, int budget)
        {
            if (++Nodes > limit) throw new LimitException();
            if (red && budget == 0) return false;
            var key = BoardKey(b, red);
            if (!table.TryGetValue(key, out var old)) old = new Entry(0, int.MaxValue, -1);
            if (old.Upper <= budget) return true;
            if (old.Lower > budget) return false;
            var ms = Moves(b, red);
            if (ms.Count == 0) return !red && Checked(b, false);
            if (!red && budget == 0) return false;
            var ordered = new List<(int Move, int Score)>(ms.Count);
            foreach (int m in ms)
            {
                var a = Apply(b, m);
                bool check = Checked(a, !red);
                if (red && budget == 1 && !check) continue;
                ordered.Add((m, m == old.Best ? -10000 : -(check ? 1000 : 0) - Math.Abs(b[m % 90]) * 10));
            }
            ordered.Sort((a, c) => a.Score != c.Score ? a.Score.CompareTo(c.Score) : a.Move.CompareTo(c.Move));
            bool found = !red; int best = -1;
            foreach (var (m, _) in ordered)
            {
                bool w = Win(Apply(b, m), !red, budget - (red ? 1 : 0));
                if (w == red) { found = red; best = m; break; }
            }
            // Recursive calls may have tightened this position at a lower budget.
            var current = table.GetValueOrDefault(key, old);
            table[key] = new Entry(found ? current.Lower : Math.Max(current.Lower, budget + 1), found ? Math.Min(current.Upper, budget) : current.Upper, best >= 0 ? best : current.Best);
            return found;
        }
        public int? Distance(sbyte[] b, int max)
        {
            for (int d = 1; d <= max; d++) if (Win(b, true, d)) return d;
            return null;
        }
        public object Tree(sbyte[] b, int d)
        {
            int best = table.GetValueOrDefault(BoardKey(b, true)).Best;
            var ms = Moves(b, true);
            if (ms.Remove(best)) ms.Insert(0, best);
            int m = ms.First(m => Win(Apply(b, m), false, d - 1));
            var a = Apply(b, m); var replies = Moves(a, false);
            Dictionary<int, object>? branches = null;
            if (replies.Count > 0)
            {
                branches = [];
                foreach (int reply in replies)
                {
                    var next = Apply(a, reply);
                    branches[reply] = Tree(next, Distance(next, d - 1)!.Value);
                }
            }
            return new object[] { d, new Dictionary<int, object?> { [m] = branches } };
        }
    }
    static sbyte[] Parse(string fen)
    {
        var b = new sbyte[90]; int s = 0;
        foreach (char ch in fen)
        {
            if (ch == '/') continue;
            if (char.IsAsciiDigit(ch)) { s += ch - '0'; continue; }
            int p = char.ToLowerInvariant(ch) switch { 'k' => 1, 'a' => 2, 'b' or 'e' => 3, 'n' or 'h' => 4, 'r' => 5, 'c' => 6, 'p' => 7, _ => throw new Exception("piece") };
            b[s++] = (sbyte)(char.IsUpper(ch) ? p : -p);
        }
        if (s != 90) throw new Exception("position");
        return b;
    }
    public static void Main()
    {
        string? line;
        while ((line = Console.ReadLine()) != null)
        {
            var args = line.Split('|'); var b = Parse(args[0]);
            if (args.Length == 2 && args[1] == "inspect")
            {
                Console.WriteLine(JsonSerializer.Serialize(new { red = Moves(b, true).Order().ToArray(), black = Moves(b, false).Order().ToArray(), redChecked = Checked(b, true), blackChecked = Checked(b, false) }));
                continue;
            }
            var search = new Search(long.Parse(args[2]));
            if (Checked(b, false)) { Console.WriteLine("{\"status\":\"invalid\"}"); continue; }
            try
            {
                int? d = search.Distance(b, int.Parse(args[1]));
                object? tree = d.HasValue ? search.Tree(b, d.Value) : null;
                Console.WriteLine(JsonSerializer.Serialize(new { status = "ok", nodes = search.Nodes, goal = d, tree }));
            }
            catch (LimitException) { Console.WriteLine(JsonSerializer.Serialize(new { status = "limit", nodes = search.Nodes })); }
        }
    }
}
