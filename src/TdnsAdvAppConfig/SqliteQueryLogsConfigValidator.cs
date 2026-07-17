using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class SqliteQueryLogsConfigValidator
{
    public static List<string> Validate(JsonNode? config)
    {
        List<string> errors = [];

        if (config is not JsonObject root)
        {
            errors.Add("Config must be a JSON object.");
            return errors;
        }

        ValidateOptionalBool(root, "enableLogging", errors);
        ValidateMaxQueueSize(root, errors);
        ValidateOptionalInt(root, "maxLogDays", errors);
        ValidateOptionalInt(root, "maxLogRecords", errors);
        ValidateOptionalBool(root, "enableVacuum", errors);
        ValidateOptionalBool(root, "useInMemoryDb", errors);

        if (root.TryGetPropertyValue("sqliteDbPath", out JsonNode? pathNode) && pathNode is not null && !TryGetString(pathNode, out _))
            errors.Add("'sqliteDbPath' must be a string when present.");

        if (root.TryGetPropertyValue("connectionString", out JsonNode? connNode) && connNode is not null && !TryGetString(connNode, out _))
            errors.Add("'connectionString' must be a string when present.");

        return errors;
    }

    private static void ValidateOptionalBool(JsonObject root, string field, List<string> errors)
    {
        if (!root.TryGetPropertyValue(field, out JsonNode? node))
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || (kind != JsonValueKind.True && kind != JsonValueKind.False))
            errors.Add($"'{field}' must be a boolean - the app throws on reload otherwise (including a present null).");
    }

    private static void ValidateMaxQueueSize(JsonObject root, List<string> errors)
    {
        if (!root.TryGetPropertyValue("maxQueueSize", out JsonNode? node))
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || kind != JsonValueKind.Number || !node!.GetValue<JsonElement>().TryGetInt32(out int value) || value < 1)
            errors.Add("'maxQueueSize' must be a whole number of at least 1 - a lower value throws on reload once logging is enabled (BoundedChannelOptions rejects a capacity below 1), including a present null.");
    }

    private static void ValidateOptionalInt(JsonObject root, string field, List<string> errors)
    {
        if (!root.TryGetPropertyValue(field, out JsonNode? node))
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || kind != JsonValueKind.Number || !node!.GetValue<JsonElement>().TryGetInt32(out int value) || value < 0)
            errors.Add($"'{field}' must be a non-negative whole number - the app throws on reload otherwise (including a present null).");
    }

    private static bool TryGetScalarKind(JsonNode? node, out JsonValueKind kind)
    {
        kind = default;

        if (node is null or JsonObject or JsonArray)
            return false;

        try
        {
            kind = node.GetValue<JsonElement>().ValueKind;
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static bool TryGetString(JsonNode? node, out string value)
    {
        value = "";

        if (!TryGetScalarKind(node, out JsonValueKind kind) || kind != JsonValueKind.String)
            return false;

        value = node!.GetValue<string>();
        return true;
    }
}
