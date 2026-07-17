using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class NxDomainConfigValidator
{
    public static List<string> Validate(JsonNode? config)
    {
        List<string> errors = [];

        if (config is not JsonObject root)
        {
            errors.Add("Config must be a JSON object.");
            return errors;
        }

        ValidateOptionalByte(root, "appPreference", errors);

        if (!root.TryGetPropertyValue("enableBlocking", out JsonNode? enableNode) || enableNode is null || !TryGetScalarKind(enableNode, out JsonValueKind enableKind) || (enableKind != JsonValueKind.True && enableKind != JsonValueKind.False))
            errors.Add("'enableBlocking' is required and must be a boolean - the app throws on every reload otherwise.");

        if (!root.TryGetPropertyValue("allowTxtBlockingReport", out JsonNode? txtNode) || txtNode is null || !TryGetScalarKind(txtNode, out JsonValueKind txtKind) || (txtKind != JsonValueKind.True && txtKind != JsonValueKind.False))
            errors.Add("'allowTxtBlockingReport' is required and must be a boolean - the app throws on every reload otherwise.");

        ValidateBlocked(root, errors);

        return errors;
    }

    private static void ValidateBlocked(JsonObject root, List<string> errors)
    {
        if (!root.TryGetPropertyValue("blocked", out JsonNode? node) || node is not JsonArray array)
        {
            errors.Add("'blocked' is required and must be an array - a missing key or wrong type throws on every reload, and a present null crashes the first query once blocking is enabled.");
            return;
        }

        HashSet<string> seen = new(StringComparer.Ordinal);

        for (int i = 0; i < array.Count; i++)
        {
            if (!TryGetString(array[i], out string domain) || string.IsNullOrEmpty(domain))
            {
                errors.Add($"blocked[{i}] must be a non-empty string - the app throws on reload otherwise (including a null entry).");
                continue;
            }

            if (!seen.Add(domain))
                errors.Add($"blocked[{i}] \"{domain}\" is a duplicate - the app throws on reload for a repeated entry (exact, case-sensitive match).");
        }
    }

    private static void ValidateOptionalByte(JsonObject root, string field, List<string> errors)
    {
        if (!root.TryGetPropertyValue(field, out JsonNode? node))
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || kind != JsonValueKind.Number || !node!.GetValue<JsonElement>().TryGetInt32(out int value) || value < 0 || value > 255)
            errors.Add($"'{field}' must be a whole number between 0 and 255 - the app throws on reload otherwise (including a present null).");
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
