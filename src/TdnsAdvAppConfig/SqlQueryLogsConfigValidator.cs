using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class SqlQueryLogsConfigValidator
{
    public static List<string> Validate(JsonNode? config, string forbiddenConnectionStringSubstring, bool stripSpacesBeforeCheck)
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

        if (root.TryGetPropertyValue("databaseName", out JsonNode? dbNameNode) && dbNameNode is not null && !TryGetString(dbNameNode, out _))
            errors.Add("'databaseName' must be a string when present.");

        ValidateConnectionString(root, forbiddenConnectionStringSubstring, stripSpacesBeforeCheck, errors);

        return errors;
    }

    private static void ValidateConnectionString(JsonObject root, string forbiddenSubstring, bool stripSpaces, List<string> errors)
    {
        if (!root.TryGetPropertyValue("connectionString", out JsonNode? node) || node is null || !TryGetString(node, out string connectionString) || string.IsNullOrWhiteSpace(connectionString))
        {
            errors.Add("'connectionString' is required and must be a non-empty string - the app throws on every reload (including at startup) otherwise.");
            return;
        }

        string haystack = stripSpaces ? connectionString.Replace(" ", "") : connectionString;

        if (haystack.Contains(forbiddenSubstring, StringComparison.OrdinalIgnoreCase))
            errors.Add($"'connectionString' must not define '{forbiddenSubstring}' - the app appends the database selector itself from 'databaseName' and throws on reload if the connection string already has one.");
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
