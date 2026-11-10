using System.Text.Json;
// Exact move-optimal A*: every edge is a shortest walk followed by one push.
// The goal matching bound ignores other boxes, never overestimating the cost.
if (args.Length > 0)
{
    var batch = JsonSerializer.Deserialize<Dictionary<string, Input>>(File.ReadAllText(args[0]))!;
    foreach (var (id, map) in batch.OrderBy(entry => entry.Value.boxes.Length))
    {
        Console.Error.WriteLine(id);
        GC.Collect();
        var result = Solve(map);
        File.AppendAllText(args[1], JsonSerializer.Serialize(new { id, result }) + "\n");
    }
    return;
}
Console.WriteLine(JsonSerializer.Serialize(Solve(JsonSerializer.Deserialize<Input>(Console.In.ReadToEnd())!)));
static Result? Solve(Input input)
{
    if (input.floors.Any(cell => cell < 0 || cell >= char.MaxValue))
        throw new ArgumentException("Board cells exceed the lossless state-key range");
    long memoryGiB = input.memoryGiB > 0 ? input.memoryGiB : input.large ? 14 : 4;
    if (memoryGiB < 2 || memoryGiB > 14) throw new ArgumentException("Memory budget must be between 2 and 14 GiB");
    if (input.reverse) return Reverse(input);
    var floors = input.floors.ToHashSet();
    var goals = input.goals.ToHashSet();
    int size = floors.Max() + input.width + 2;
    int[] deltas = [-input.width, 1, input.width, -1];
    char[] directions = ['u', 'r', 'd', 'l'];
    var distances = new List<int[]>();
    foreach (int goal in goals)
    {
        var dist = Enumerable.Repeat(1000000, size).ToArray();
        var queue = new Queue<int>(); queue.Enqueue(goal); dist[goal] = 0;
        while (queue.TryDequeue(out int c)) foreach (int d in deltas)
        {
            int next = c - d;
            if (floors.Contains(next) && floors.Contains(next - d) && dist[next] == 1000000)
            {
                dist[next] = dist[c] + 1; queue.Enqueue(next);
            }
        }
        distances.Add(dist);
    }
    // Project every pair of boxes onto an otherwise empty board. Reverse BFS
    // from every goal pair proves pair deadlocks and a push-count lower bound.
    int countFloors = floors.Count;
    if (countFloors > 512) throw new ArgumentException("Pattern keys support up to 512 floor cells");
    var floorIndex = Enumerable.Repeat(-1, size).ToArray();
    int floorNumber = 0;
    foreach (int cell in floors.Order()) floorIndex[cell] = floorNumber++;
    int[]? pairs = null;
    int PairIndex(int a, int b, int player)
    {
        a = floorIndex[a]; b = floorIndex[b];
        if (a > b) (a, b) = (b, a);
        return (a * countFloors + b) * countFloors + floorIndex[player];
    }
    if (input.boxes.Length >= 2 && (long)countFloors * countFloors * countFloors <= 30000000)
    {
        pairs = Enumerable.Repeat(-1, countFloors * countFloors * countFloors).ToArray();
        var reverse = new Queue<(int a, int b, int player, int cost)>();
        var flood = new int[size]; var reach = new int[size]; int stamp = 0;
        void Seed(int a, int b, int player, int cost)
        {
            if (pairs[PairIndex(a, b, player)] >= 0) return;
            int count = 1; flood[0] = player; pairs[PairIndex(a, b, player)] = cost;
            for (int i = 0; i < count; i++) foreach (int delta in deltas)
            {
                int next = flood[i] + delta;
                if (!floors.Contains(next) || next == a || next == b) continue;
                int index = PairIndex(a, b, next);
                if (pairs[index] >= 0) continue;
                pairs[index] = cost; flood[count++] = next;
            }
            reverse.Enqueue((a, b, player, cost));
        }
        var goalList = goals.ToArray();
        for (int i = 0; i < goalList.Length; i++) for (int j = i + 1; j < goalList.Length; j++)
            foreach (int player in floors) if (player != goalList[i] && player != goalList[j])
                Seed(goalList[i], goalList[j], player, 0);
        while (reverse.TryDequeue(out var state))
        {
            stamp++; int count = 1; flood[0] = state.player; reach[state.player] = stamp;
            for (int i = 0; i < count; i++) foreach (int delta in deltas)
            {
                int next = flood[i] + delta;
                if (floors.Contains(next) && next != state.a && next != state.b && reach[next] != stamp)
                {
                    reach[next] = stamp; flood[count++] = next;
                }
            }
            foreach (int box in new[] { state.a, state.b }) foreach (int delta in deltas)
            {
                int dest = box - delta, player = box - 2 * delta;
                if (!floors.Contains(dest) || reach[dest] != stamp || !floors.Contains(player) ||
                    player == state.a || player == state.b) continue;
                Seed(box == state.a ? dest : state.a, box == state.b ? dest : state.b, player, state.cost + 1);
            }
        }
    }
    // Exact movement distances for the same two-box projection. Taking their
    // maximum is admissible; unlike push counts, walking costs must not be summed.
    int[]? pairMoves = null;
    if (pairs != null)
    {
        pairMoves = Enumerable.Repeat(-1, pairs.Length).ToArray();
        var floorCells = floors.Order().ToArray();
        var neighbours = new int[countFloors, 4];
        for (int i = 0; i < countFloors; i++) for (int d = 0; d < 4; d++)
        {
            int next = floorCells[i] + deltas[d];
            neighbours[i, d] = floors.Contains(next) ? floorIndex[next] : -1;
        }
        var queue = new Queue<int>();
        void Visit(int a, int b, int player, int cost)
        {
            if (a > b) (a, b) = (b, a);
            int key = (a * countFloors + b) * countFloors + player;
            if (pairMoves[key] >= 0) return;
            pairMoves[key] = cost; queue.Enqueue(key);
        }
        var goalCells = goals.Select(g => floorIndex[g]).ToArray();
        for (int i = 0; i < goalCells.Length; i++) for (int j = i + 1; j < goalCells.Length; j++)
            for (int player = 0; player < countFloors; player++) if (player != goalCells[i] && player != goalCells[j])
                Visit(goalCells[i], goalCells[j], player, 0);
        while (queue.TryDequeue(out int key))
        {
            int player = key % countFloors, b = key / countFloors % countFloors, a = key / countFloors / countFloors;
            int cost = pairMoves[key] + 1;
            for (int d = 0; d < 4; d++)
            {
                int previous = neighbours[player, d];
                if (previous < 0 || previous == a || previous == b) continue;
                Visit(a, b, previous, cost);
                int ahead = neighbours[player, (d + 2) % 4];
                if (ahead == a) Visit(player, b, previous, cost);
                if (ahead == b) Visit(a, player, previous, cost);
            }
        }
    }
    int[]? tripleMoves = null;
    int[] choose2 = new int[countFloors + 1], choose3 = new int[countFloors + 1];
    for (int i = 0; i <= countFloors; i++) { choose2[i] = i * (i - 1) / 2; choose3[i] = i * (i - 1) * (i - 2) / 6; }
    int TripleIndex(int a, int b, int c, int player)
    {
        if (a > b) (a, b) = (b, a); if (b > c) (b, c) = (c, b); if (a > b) (a, b) = (b, a);
        return (choose3[c] + choose2[b] + a) * countFloors + player;
    }
    if (input.boxes.Length >= 3 && (long)choose3[countFloors] * countFloors <= 80000000)
    {
        tripleMoves = Enumerable.Repeat(-1, choose3[countFloors] * countFloors).ToArray();
        var floorCells = floors.Order().ToArray(); var neighbours = new int[countFloors, 4];
        for (int i = 0; i < countFloors; i++) for (int d = 0; d < 4; d++)
        {
            int next = floorCells[i] + deltas[d]; neighbours[i, d] = floors.Contains(next) ? floorIndex[next] : -1;
        }
        var queue = new Queue<ulong>();
        void Visit(int a, int b, int c, int player, int cost)
        {
            int key = TripleIndex(a, b, c, player);
            if (tripleMoves[key] >= 0) return;
            tripleMoves[key] = cost;
            queue.Enqueue((((ulong)a * (ulong)countFloors + (ulong)b) * (ulong)countFloors + (ulong)c) * (ulong)countFloors + (ulong)player);
        }
        var targets = goals.Select(g => floorIndex[g]).ToArray();
        for (int i = 0; i < targets.Length; i++) for (int j = i + 1; j < targets.Length; j++) for (int k = j + 1; k < targets.Length; k++)
            for (int player = 0; player < countFloors; player++) if (player != targets[i] && player != targets[j] && player != targets[k])
                Visit(targets[i], targets[j], targets[k], player, 0);
        while (queue.TryDequeue(out ulong encoded))
        {
            int player = (int)(encoded % (ulong)countFloors); encoded /= (ulong)countFloors;
            int c = (int)(encoded % (ulong)countFloors); encoded /= (ulong)countFloors;
            int b = (int)(encoded % (ulong)countFloors), a = (int)(encoded / (ulong)countFloors);
            int cost = tripleMoves[TripleIndex(a, b, c, player)] + 1;
            for (int d = 0; d < 4; d++)
            {
                int previous = neighbours[player, d];
                if (previous < 0 || previous == a || previous == b || previous == c) continue;
                Visit(a, b, c, previous, cost);
                int ahead = neighbours[player, (d + 2) % 4];
                if (ahead == a) Visit(player, b, c, previous, cost);
                if (ahead == b) Visit(a, player, c, previous, cost);
                if (ahead == c) Visit(a, b, player, previous, cost);
            }
        }
    }
    // Sparse exact movement database: allocate player distances only for box
    // layouts reached by reverse BFS. Distances saturate conservatively at 65534.
    List<ushort[]>? patternMoves = null;
    Dictionary<ulong, int>? patternIds = null;
    int patternSize = 0;
    int PatternDistance(long index)
    {
        int value = patternMoves![(int)(index >> 24)][(int)(index & ((1 << 24) - 1))];
        return value == ushort.MaxValue ? -1 : value;
    }
    long Combination(int n, int k)
    {
        long result = 1;
        for (int i = 1; i <= k; i++) result = result * (n - i + 1) / i;
        return result;
    }
    if (input.boxes.Length >= 4)
    {
        patternSize = input.projection > 0 ? Math.Min(input.projection, input.boxes.Length) : input.large && input.boxes.Length >= 6 ? 6 :
            input.boxes.Length >= 5 && Combination(countFloors, 5) * countFloors <= 400000000 ? 5 : 4;
        ulong capacity = 1;
        for (int i = 0; i <= patternSize; i++)
        {
            if (capacity > ulong.MaxValue / (ulong)countFloors) throw new ArgumentException("Projection key exceeds its lossless range");
            capacity *= (ulong)countFloors;
        }
        var timer = System.Diagnostics.Stopwatch.StartNew();
        patternMoves = new List<ushort[]>(); patternIds = new Dictionary<ulong, int>();
        var floorCells = floors.Order().ToArray(); var neighbours = new int[countFloors, 4];
        for (int i = 0; i < countFloors; i++) for (int d = 0; d < 4; d++)
        {
            int next = floorCells[i] + deltas[d]; neighbours[i, d] = floors.Contains(next) ? floorIndex[next] : -1;
        }
        var queue = new Queue<ulong>(); var scratch = new int[patternSize];
        long Index(int[] boxes, int player)
        {
            Array.Copy(boxes, scratch, patternSize); Array.Sort(scratch);
            ulong key = 0;
            for (int i = 0; i < patternSize; i++) key = key * (ulong)countFloors + (ulong)scratch[i];
            if (!patternIds.TryGetValue(key, out int id))
            {
                id = patternIds.Count; patternIds[key] = id;
                long required = ((long)id + 1) * countFloors;
                while ((long)patternMoves.Count * (1 << 24) < required)
                {
                    var page = new ushort[1 << 24]; Array.Fill(page, ushort.MaxValue); patternMoves.Add(page);
                }
            }
            return (long)id * countFloors + player;
        }
        void Visit(int[] boxes, int player, int cost)
        {
            long key = Index(boxes, player);
            if (PatternDistance(key) >= 0) return;
            patternMoves[(int)(key >> 24)][(int)(key & ((1 << 24) - 1))] = (ushort)Math.Min(cost, ushort.MaxValue - 1);
            ulong encoded = 0;
            for (int i = 0; i < patternSize; i++) encoded = encoded * (ulong)countFloors + (ulong)scratch[i];
            queue.Enqueue(encoded * (ulong)countFloors + (ulong)player);
        }
        var targets = goals.Select(g => floorIndex[g]).ToArray(); var seed = new int[patternSize];
        void Seed(int index, int start)
        {
            if (index == patternSize)
            {
                for (int player = 0; player < countFloors; player++) if (!seed.Contains(player)) Visit(seed, player, 0);
                return;
            }
            for (int i = start; i <= targets.Length - (patternSize - index); i++) { seed[index] = targets[i]; Seed(index + 1, i + 1); }
        }
        Seed(0, 0); var boxes = new int[patternSize]; long expanded = 0;
        while (queue.TryDequeue(out ulong encoded))
        {
            if (++expanded % 16384 == 0 && (timer.ElapsedMilliseconds > (input.large ? 300000 : 120000) ||
                GC.GetTotalMemory(false) > Math.Min(memoryGiB, input.large ? 12L : 3L) * 1024 * 1024 * 1024))
            {
                patternMoves = null; patternIds = null; queue.Clear(); break;
            }
            int player = (int)(encoded % (ulong)countFloors); encoded /= (ulong)countFloors;
            for (int i = patternSize - 1; i >= 0; i--) { boxes[i] = (int)(encoded % (ulong)countFloors); encoded /= (ulong)countFloors; }
            int cost = PatternDistance(Index(boxes, player)) + 1;
            for (int d = 0; d < 4; d++)
            {
                int previous = neighbours[player, d];
                if (previous < 0 || boxes.Contains(previous)) continue;
                Visit(boxes, previous, cost);
                int ahead = neighbours[player, (d + 2) % 4], boxIndex = Array.IndexOf(boxes, ahead);
                if (boxIndex >= 0) { int old = boxes[boxIndex]; boxes[boxIndex] = player; Visit(boxes, previous, cost); boxes[boxIndex] = old; }
            }
        }
        Console.Error.WriteLine($"Projected {patternSize} boxes: {(patternMoves == null ? "discarded" : "complete")}, {expanded} states, {timer.ElapsedMilliseconds} ms");
    }
    var patterns = new List<int[]>();
    if (patternMoves != null)
    {
        var subset = new int[patternSize];
        void Select(int index, int start)
        {
            if (index == patternSize) { patterns.Add((int[])subset.Clone()); return; }
            for (int i = start; i <= input.boxes.Length - (patternSize - index); i++) { subset[index] = i; Select(index + 1, i + 1); }
        }
        Select(0, 0);
        if (patterns.Count > 128) patterns = Enumerable.Range(0, 128).Select(i => patterns[i * (patterns.Count - 1) / 127]).ToList();
    }
    var patternCache = new Dictionary<string, int[]>();
    var patternOrder = new Queue<string>();
    int PatternBound(int[] boxes, int player)
    {
        if (patternMoves == null) return 0;
        string key = new string(Array.ConvertAll(boxes, b => (char)b));
        if (!patternCache.TryGetValue(key, out var ids))
        {
            ids = new int[patterns.Count];
            for (int p = 0; p < patterns.Count; p++)
            {
                ulong layout = 0;
                // Floor indices and box positions are both in ascending order.
                foreach (int index in patterns[p]) layout = layout * (ulong)countFloors + (ulong)floorIndex[boxes[index]];
                ids[p] = patternIds!.TryGetValue(layout, out int id) ? id : -1;
            }
            if (patternCache.Count >= 100000) patternCache.Remove(patternOrder.Dequeue());
            patternCache[key] = ids; patternOrder.Enqueue(key);
        }
        int maximum = 0;
        foreach (int id in ids)
        {
            if (id < 0) return 1000000;
            int cost = PatternDistance((long)id * countFloors + floorIndex[player]);
            if (cost < 0) return 1000000;
            maximum = Math.Max(maximum, cost);
        }
        return maximum;
    }
    int TripleBound(int[] boxes, int player)
    {
        if (tripleMoves == null) return 0;
        int maximum = 0, p = floorIndex[player];
        for (int i = 0; i < boxes.Length; i++) for (int j = i + 1; j < boxes.Length; j++) for (int k = j + 1; k < boxes.Length; k++)
        {
            int cost = tripleMoves[TripleIndex(floorIndex[boxes[i]], floorIndex[boxes[j]], floorIndex[boxes[k]], p)];
            if (cost < 0) return 1000000;
            maximum = Math.Max(maximum, cost);
        }
        return maximum;
    }
    int PairMoveBound(int[] boxes, int player)
    {
        if (pairMoves == null) return 0;
        int maximum = 0;
        for (int i = 0; i < boxes.Length; i++) for (int j = i + 1; j < boxes.Length; j++)
        {
            int cost = pairMoves[PairIndex(boxes[i], boxes[j], player)];
            if (cost < 0) return 1000000;
            maximum = Math.Max(maximum, cost);
        }
        return maximum;
    }
    int PairBound(int[] boxes, int player)
    {
        if (pairs == null) return 0;
        int sum = 0, maximum = 0;
        for (int i = 0; i < boxes.Length; i++) for (int j = i + 1; j < boxes.Length; j++)
        {
            int cost = pairs[PairIndex(boxes[i], boxes[j], player)];
            if (cost < 0) return 1000000;
            maximum = Math.Max(maximum, cost);
            if (i % 2 == 0 && j == i + 1) sum += cost;
        }
        if (boxes.Length % 2 != 0) sum += distances.Min(dist => dist[boxes[^1]]);
        return Math.Max(sum, maximum);
    }
    var estimates = new Dictionary<string, int>();
    int Bound(int[] boxes)
    {
        string key = new string(Array.ConvertAll(boxes, b => (char)b));
        if (estimates.TryGetValue(key, out int cached)) return cached;
        int n = boxes.Length;
        var u = new int[n + 1]; var v = new int[n + 1]; var p = new int[n + 1]; var way = new int[n + 1];
        for (int i = 1; i <= n; i++)
        {
            p[0] = i; int j0 = 0;
            var min = Enumerable.Repeat(int.MaxValue, n + 1).ToArray(); var used = new bool[n + 1];
            do
            {
                used[j0] = true; int i0 = p[j0], delta = int.MaxValue, j1 = 0;
                for (int j = 1; j <= n; j++) if (!used[j])
                {
                    int cost = distances[j - 1][boxes[i0 - 1]] - u[i0] - v[j];
                    if (cost < min[j]) { min[j] = cost; way[j] = j0; }
                    if (min[j] < delta) { delta = min[j]; j1 = j; }
                }
                for (int j = 0; j <= n; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else min[j] -= delta;
                j0 = j1;
            } while (p[j0] != 0);
            do { int j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0 != 0);
        }
        int result = -v[0]; if (estimates.Count < 1000000) estimates[key] = result; return result;
    }
    var pending = new PriorityQueue<Node, (int, int)>();
    var best = new Dictionary<string, int>();
    string Key(int[] boxes, int player)
    {
        var chars = new char[boxes.Length + 1];
        for (int i = 0; i < boxes.Length; i++) chars[i] = (char)boxes[i];
        chars[^1] = (char)player;
        return new string(chars);
    }
    int upper = input.upper;
    void Add(Node node)
    {
        string key = Key(node.boxes, node.player);
        if (best.TryGetValue(key, out int old) && old <= node.cost) return;
        int bound = Math.Max(Math.Max(Bound(node.boxes), PairBound(node.boxes, node.player)), PairMoveBound(node.boxes, node.player));
        if (node.cost + bound > upper) return;
        best[key] = node.cost; pending.Enqueue(node, (node.cost + bound, -node.cost));
    }
    Add(new Node(input.player, input.boxes.Order().ToArray(), 0, null, ""));
    var watch = System.Diagnostics.Stopwatch.StartNew(); long nodes = 0;
    var occupied = new bool[size]; var walk = new int[size]; var prev = new int[size]; var via = new int[size]; var cells = new int[size];
    while (pending.TryDequeue(out var cur, out var priority))
    {
        if (++nodes % 4096 == 0 && (watch.ElapsedMilliseconds > input.milliseconds ||
            GC.GetTotalMemory(false) > memoryGiB * 1024 * 1024 * 1024)) break;
        if (best[Key(cur.boxes, cur.player)] < cur.cost) continue;
        if (cur.boxes.All(goals.Contains))
        {
            var segments = new List<string>(); for (var n = cur; n.parent != null; n = n.parent) segments.Add(n.segment);
            segments.Reverse(); return new Result(cur.cost, string.Concat(segments), nodes);
        }
        if (cur.lower == 0)
            cur.lower = cur.cost + Math.Max(PairMoveBound(cur.boxes, cur.player), Math.Max(TripleBound(cur.boxes, cur.player), PatternBound(cur.boxes, cur.player)));
        if (cur.lower > upper) continue;
        if (priority.Item1 < cur.lower) { pending.Enqueue(cur, (cur.lower, -cur.cost)); continue; }
        Array.Clear(occupied); foreach (int b in cur.boxes) occupied[b] = true;
        Array.Fill(walk, -1); walk[cur.player] = 0; int count = 1; cells[0] = cur.player;
        for (int i = 0; i < count; i++) for (int d = 0; d < 4; d++)
        {
            int next = cells[i] + deltas[d];
            if (floors.Contains(next) && !occupied[next] && walk[next] < 0)
            {
                walk[next] = walk[cells[i]] + 1; prev[next] = cells[i]; via[next] = d; cells[count++] = next;
            }
        }
        // Every solution must first walk to a legal push. These walking steps
        // cannot overlap with the push-only matching bound.
        int approach = int.MaxValue;
        foreach (int box in cur.boxes) foreach (int delta in deltas)
        {
            int dest = box + delta, behind = box - delta;
            if (floors.Contains(dest) && !occupied[dest] && floors.Contains(behind) && walk[behind] >= 0)
                approach = Math.Min(approach, walk[behind]);
        }
        if (approach == int.MaxValue) continue;
        int refined = Math.Max(cur.lower, cur.cost + Math.Max(Bound(cur.boxes), PairBound(cur.boxes, cur.player)) + approach);
        if (refined > upper) continue;
        if (priority.Item1 < refined) { pending.Enqueue(cur, (refined, -cur.cost)); continue; }
        foreach (int box in cur.boxes) for (int d = 0; d < 4; d++)
        {
            int dest = box + deltas[d], behind = box - deltas[d];
            if (!floors.Contains(dest) || occupied[dest] || !floors.Contains(behind) || walk[behind] < 0) continue;
            int cost = cur.cost + walk[behind] + 1;
            if (cost > upper) continue;
            int[] boxes = (int[])cur.boxes.Clone(); boxes[Array.IndexOf(boxes, box)] = dest; Array.Sort(boxes);
            occupied[box] = false; occupied[dest] = true;
            bool dead = false;
            foreach (int dx in new[] { -1, 1 }) foreach (int dy in new[] { -input.width, input.width })
            {
                int[] square = [dest, dest + dx, dest + dy, dest + dx + dy];
                if (square.All(c => !floors.Contains(c) || occupied[c]) && square.Any(c => floors.Contains(c) && occupied[c] && !goals.Contains(c))) dead = true;
            }
            occupied[box] = true; occupied[dest] = false;
            if (dead) continue;
            var segment = new char[walk[behind] + 1]; segment[^1] = directions[d];
            for (int c = behind, i = segment.Length - 2; i >= 0; i--, c = prev[c]) segment[i] = directions[via[c]];
            Add(new Node(box, boxes, cost, cur, new string(segment)));
        }
    }
    return null;
}
static Result? Reverse(Input input)
{
    var cells = input.floors.Order().ToArray(); int n = cells.Length;
    if (n > 120) throw new ArgumentException("Reverse state keys support 120 floor cells");
    var index = cells.Select((cell, i) => (cell, i)).ToDictionary(p => p.cell, p => p.i);
    int[] deltas = [-input.width, 1, input.width, -1]; char[] directions = ['u', 'r', 'd', 'l'];
    var next = new int[n, 4];
    for (int i = 0; i < n; i++) for (int d = 0; d < 4; d++) next[i, d] = index.GetValueOrDefault(cells[i] + deltas[d], -1);
    UInt128 mask = 0, goalMask = 0;
    foreach (int box in input.boxes) mask |= (UInt128)1 << index[box];
    foreach (int goal in input.goals) goalMask |= (UInt128)1 << index[goal];
    var canGoal = new bool[n]; var reachQueue = new Queue<int>();
    foreach (int goal in input.goals) { canGoal[index[goal]] = true; reachQueue.Enqueue(index[goal]); }
    while (reachQueue.TryDequeue(out int cell)) for (int d = 0; d < 4; d++)
    {
        int previous = next[cell, d];
        if (previous >= 0 && next[previous, d] >= 0 && !canGoal[previous]) { canGoal[previous] = true; reachQueue.Enqueue(previous); }
    }
    bool Blocked(UInt128 boxes, int dest)
    {
        foreach (int dx in new[] { -1, 1 }) foreach (int dy in new[] { -input.width, input.width })
        {
            int[] square = [cells[dest], cells[dest] + dx, cells[dest] + dy, cells[dest] + dx + dy];
            if (square.All(c => !index.TryGetValue(c, out int i) || (boxes & ((UInt128)1 << i)) != 0) &&
                square.Any(c => index.TryGetValue(c, out int i) && (boxes & ((UInt128)1 << i)) != 0 && (goalMask & ((UInt128)1 << i)) == 0)) return true;
        }
        return false;
    }
    UInt128 bits = ((UInt128)1 << n) - 1;
    UInt128 target = mask | ((UInt128)index[input.player] << n);
    var forward = new Dictionary<UInt128, int> { { target, 0 } }; var backward = new Dictionary<UInt128, int>();
    var front = new List<UInt128> { target }; var back = new List<UInt128>();
    for (int player = 0; player < n; player++) if ((goalMask & ((UInt128)1 << player)) == 0)
    {
        UInt128 key = goalMask | ((UInt128)player << n); backward[key] = 0; back.Add(key);
    }
    long nodes = 0; var timer = System.Diagnostics.Stopwatch.StartNew();
    IEnumerable<(UInt128 key, char direction)> Edges(UInt128 key, bool reverse)
    {
        int player = (int)(key >> n); UInt128 boxes = key & bits;
        for (int d = 0; d < 4; d++)
        {
            int dest = next[player, d]; if (dest < 0) continue;
            UInt128 moved = boxes, bit = (UInt128)1 << dest;
            if (!reverse)
            {
                if ((boxes & bit) != 0)
                {
                    int beyond = next[dest, d];
                    if (beyond < 0 || !canGoal[beyond] || (boxes & ((UInt128)1 << beyond)) != 0) continue;
                    moved = (boxes ^ bit) | ((UInt128)1 << beyond);
                    if (Blocked(moved, beyond)) continue;
                }
                yield return (moved | ((UInt128)dest << n), directions[d]);
            }
            else if ((boxes & bit) == 0)
            {
                yield return (boxes | ((UInt128)dest << n), directions[(d + 2) % 4]);
                int ahead = next[player, (d + 2) % 4];
                if (ahead >= 0 && (boxes & ((UInt128)1 << ahead)) != 0)
                    yield return (((boxes ^ ((UInt128)1 << ahead)) | ((UInt128)1 << player)) | ((UInt128)dest << n), directions[(d + 2) % 4]);
            }
        }
    }
    while (front.Count > 0 && back.Count > 0)
    {
        bool reverse = back.Count < front.Count;
        var current = reverse ? back : front; var own = reverse ? backward : forward; var other = reverse ? forward : backward;
        var layer = new List<UInt128>(); int optimum = int.MaxValue; UInt128 meeting = 0;
        foreach (UInt128 key in current)
        {
            if (++nodes % 16384 == 0 && (timer.ElapsedMilliseconds > input.milliseconds ||
                GC.GetTotalMemory(false) > (input.memoryGiB > 0 ? input.memoryGiB : 8L) * 1024 * 1024 * 1024)) return null;
            int cost = own[key] + 1;
            foreach (var edge in Edges(key, reverse))
            {
                if (own.TryAdd(edge.key, cost)) layer.Add(edge.key);
                if (other.TryGetValue(edge.key, out int remaining) && cost + remaining < optimum)
                {
                    optimum = cost + remaining; meeting = edge.key;
                }
            }
        }
        if (optimum < int.MaxValue)
        {
            var prefix = new List<char>(); UInt128 state = meeting;
            int distance = forward[state];
            while (distance > 0)
            {
                bool found = false;
                foreach (var edge in Edges(state, true)) if (forward.TryGetValue(edge.key, out int value) && value == distance - 1)
                {
                    prefix.Add(edge.direction); state = edge.key; distance--; found = true; break;
                }
                if (!found) throw new InvalidOperationException("Forward witness missing");
            }
            prefix.Reverse(); var path = new System.Text.StringBuilder(new string(prefix.ToArray()));
            state = meeting; distance = backward[state];
            while (distance > 0)
            {
                bool found = false;
                foreach (var edge in Edges(state, false)) if (backward.TryGetValue(edge.key, out int value) && value == distance - 1)
                {
                    path.Append(edge.direction); state = edge.key; distance--; found = true; break;
                }
                if (!found) throw new InvalidOperationException("Reverse witness missing");
            }
            return new Result(path.Length, path.ToString(), nodes);
        }
        if (reverse) back = layer; else front = layer;
    }
    return null;
}
record Input(int width, int player, int[] boxes, int[] goals, int[] floors, int upper, long milliseconds, bool large = false, int projection = 0, int memoryGiB = 0, bool reverse = false);
record Node(int player, int[] boxes, int cost, Node? parent, string segment) { public int lower; }

record Result(int value, string path, long nodes);
