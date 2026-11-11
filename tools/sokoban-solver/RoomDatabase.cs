using System.Numerics;

// Project all boxes inside a room. Outside boxes vanish, and the player can
// reach any outside cell for free. A move is charged only to the room that
// contains its forward destination, so disjoint room bounds can be summed.
sealed class RoomDatabase
{
    const int PageBits = 22, PageSize = 1 << PageBits;
    readonly Dictionary<int, int> index;
    readonly Dictionary<ulong, int> layouts = new();
    readonly List<ushort[]> pages = new();
    readonly int outside;
    int coverage = int.MaxValue;

    long Address(ulong boxes, int player, bool create)
    {
        if (!layouts.TryGetValue(boxes, out int id))
        {
            if (!create) return -1;
            id = layouts.Count;
            layouts.Add(boxes, id);
            long required = ((long)id + 1) * (outside + 1);
            while ((long)pages.Count * PageSize < required)
            {
                var page = new ushort[PageSize];
                Array.Fill(page, ushort.MaxValue);
                pages.Add(page);
            }
        }
        return (long)id * (outside + 1) + player;
    }

    int Distance(long address) => address < 0 ? ushort.MaxValue :
        pages[(int)(address >> PageBits)][(int)(address & (PageSize - 1))];

    public int Bound(int[] boxes, int player)
    {
        ulong mask = 0;
        foreach (int box in boxes)
            if (index.TryGetValue(box, out int bit)) mask |= 1UL << bit;
        int distance = Distance(Address(mask, index.GetValueOrDefault(player, outside), false));
        // A budget stop proves only that unvisited states are at least as far
        // away as the first unfinished layer, not that they are deadlocks.
        return distance == ushort.MaxValue ? (coverage == int.MaxValue ? 1000000 : coverage) :
            Math.Min(distance, coverage);
    }

    public RoomDatabase(Input input, int[] room, long memoryGiB)
    {
        room = room.Order().ToArray();
        outside = room.Length;
        index = room.Select((cell, i) => (cell, i)).ToDictionary(p => p.cell, p => p.i);
        var floors = input.floors.ToHashSet();
        int[] deltas = [-input.width, 1, input.width, -1];
        var live = input.goals.ToHashSet();
        var liveQueue = new Queue<int>(live);
        while (liveQueue.TryDequeue(out int cell))
            foreach (int d in deltas)
                if (floors.Contains(cell - d) && floors.Contains(cell - 2 * d) && live.Add(cell - d))
                    liveQueue.Enqueue(cell - d);

        // Only boundary transitions affect the projection when the player
        // starts outside. Reverse pulls may remove a box from the room.
        var entries = new HashSet<int>();
        var exits = new HashSet<(int box, int player)>();
        foreach (int cell in floors.Where(c => !index.ContainsKey(c)))
            foreach (int d in deltas)
                if (index.TryGetValue(cell - d, out int box))
                {
                    entries.Add(box);
                    if (floors.Contains(cell + d))
                        exits.Add((box, index.GetValueOrDefault(cell + d, outside)));
                }

        var current = new Queue<ulong>();
        var next = new Queue<ulong>();
        int layer = 0;
        void Visit(ulong boxes, int player, int cost)
        {
            long address = Address(boxes, player, true);
            if (Distance(address) <= cost) return;
            pages[(int)(address >> PageBits)][(int)(address & (PageSize - 1))] = (ushort)cost;
            (cost == layer ? current : next).Enqueue((boxes << 6) | (uint)player);
        }
        bool Occupied(ulong boxes, int player) => player < outside && (boxes & (1UL << player)) != 0;

        ulong goal = 0;
        foreach (int cell in input.goals)
            if (index.TryGetValue(cell, out int bit)) goal |= 1UL << bit;
        for (int player = 0; player <= outside; player++)
            if (!Occupied(goal, player)) Visit(goal, player, 0);

        GC.Collect();
        long memoryLimit = Math.Min(memoryGiB * 1024 * 1024 * 1024,
            GC.GetTotalMemory(false) + 1536L * 1024 * 1024);
        var timer = System.Diagnostics.Stopwatch.StartNew();
        long expanded = 0;
        while (current.Count > 0 || next.Count > 0)
        {
            if (current.Count == 0) { (current, next) = (next, current); layer++; }
            if (layer > Math.Min(input.upper, ushort.MaxValue - 2)) { coverage = layer; break; }
            ulong state = current.Dequeue(), boxes = state >> 6;
            int player = (int)(state & 63);
            if (Distance(Address(boxes, player, false)) != layer) continue;
            if (++expanded % 1048576 == 0 &&
                (timer.ElapsedMilliseconds > 300000 || GC.GetTotalMemory(false) > memoryLimit))
            {
                coverage = layer;
                break;
            }
            if (player == outside)
            {
                foreach (int entry in entries)
                    if (!Occupied(boxes, entry)) Visit(boxes, entry, layer);
                foreach (var exit in exits)
                    if (Occupied(boxes, exit.box) && !Occupied(boxes, exit.player))
                        Visit(boxes & ~(1UL << exit.box), exit.player, layer);
                continue;
            }
            int position = room[player];
            foreach (int d in deltas)
            {
                if (!floors.Contains(position + d)) continue;
                int previousPlayer = index.GetValueOrDefault(position + d, outside);
                if (Occupied(boxes, previousPlayer)) continue;
                Visit(boxes, previousPlayer, layer + 1);
                if (!live.Contains(position) || !floors.Contains(position - d)) continue;
                int previousBox = index.GetValueOrDefault(position - d, outside);
                if (previousBox == outside)
                {
                    // The reverse of a forward push that left the room.
                    if (BitOperations.PopCount(boxes) < input.boxes.Length)
                        Visit(boxes | (1UL << player), previousPlayer, layer + 1);
                }
                else if (Occupied(boxes, previousBox))
                    Visit((boxes & ~(1UL << previousBox)) | (1UL << player), previousPlayer, layer + 1);
            }
        }
        string status = coverage == int.MaxValue ? "complete" : $"covered to {coverage} moves";
        Console.Error.WriteLine($"Room projection {status}: {expanded} states, {layouts.Count} layouts, " +
            $"initial bound {Bound(input.boxes, input.player)}, {timer.ElapsedMilliseconds} ms");
    }
}
