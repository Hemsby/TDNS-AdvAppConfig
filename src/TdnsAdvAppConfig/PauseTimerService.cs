using System.Text.Json;
using System.Threading;

namespace TdnsAdvAppConfig;

public sealed class PauseTimerService : IDisposable
{
    public const string RootTarget = "\0root";

    private readonly string _stateFilePath;
    private readonly BlockingService _blockingService;
    private readonly Dictionary<string, DateTime> _timers = new();
    private readonly Lock _lock = new();
    private readonly Timer _ticker;

    public PauseTimerService(BlockingService blockingService)
    {
        _blockingService = blockingService;
        _stateFilePath = Path.Combine(AppContext.BaseDirectory, "pause-timers.json");

        LoadState();

        _ticker = new Timer(TickCallback, null, TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(1));
    }

    public void SchedulePause(string target, TimeSpan duration)
    {
        lock (_lock)
        {
            _timers[target] = DateTime.UtcNow.Add(duration);
            SaveState();
        }
    }

    public void CancelPause(string target)
    {
        lock (_lock)
        {
            if (_timers.Remove(target))
                SaveState();
        }
    }

    public DateTime? GetExpiry(string target)
    {
        lock (_lock)
        {
            return _timers.TryGetValue(target, out DateTime expiry) ? expiry : null;
        }
    }

    private async void TickCallback(object? state)
    {
        List<string> expired;

        lock (_lock)
        {
            DateTime now = DateTime.UtcNow;
            expired = _timers.Where(kv => kv.Value <= now).Select(kv => kv.Key).ToList();
        }

        if (expired.Count == 0)
            return;

        foreach (string target in expired)
        {
            try
            {
                if (target == RootTarget)
                    await _blockingService.SetRootEnabledAsync(true);
                else
                    await _blockingService.SetGroupEnabledAsync(target, true);
            }
            catch
            {
            }
        }

        lock (_lock)
        {
            foreach (string target in expired)
                _timers.Remove(target);

            SaveState();
        }
    }

    private void LoadState()
    {
        if (!File.Exists(_stateFilePath))
            return;

        try
        {
            Dictionary<string, DateTime>? loaded = JsonSerializer.Deserialize<Dictionary<string, DateTime>>(File.ReadAllText(_stateFilePath));
            if (loaded is not null)
            {
                foreach (KeyValuePair<string, DateTime> kv in loaded)
                    _timers[kv.Key] = kv.Value;
            }
        }
        catch
        {
        }
    }

    private void SaveState()
    {
        try
        {
            File.WriteAllText(_stateFilePath, JsonSerializer.Serialize(_timers));
        }
        catch
        {
        }
    }

    public void Dispose()
    {
        _ticker.Dispose();
    }
}
