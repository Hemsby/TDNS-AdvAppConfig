using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class DnsBlockListConfigValidator
{
    private static readonly string[] ValidTypes = ["Ip", "Domain"];

    public static List<string> Validate(JsonNode? config)
    {
        List<string> errors = [];

        if (config is not JsonObject root)
        {
            errors.Add("Config must be a JSON object.");
            return errors;
        }

        if (!root.TryGetPropertyValue("dnsBlockLists", out JsonNode? listsNode) || listsNode is not JsonArray lists)
        {
            errors.Add("'dnsBlockLists' is required and must be an array.");
            return errors;
        }

        HashSet<string> seenNames = new(StringComparer.Ordinal);

        for (int i = 0; i < lists.Count; i++)
        {
            string prefix = $"dnsBlockLists[{i}]";

            if (lists[i] is not JsonObject list)
            {
                errors.Add($"{prefix} must be an object.");
                continue;
            }

            if (!list.TryGetPropertyValue("name", out JsonNode? nameNode) || !TryGetString(nameNode, out string name) || string.IsNullOrWhiteSpace(name))
                errors.Add($"{prefix}.name is required and must be a non-empty string.");
            else if (!seenNames.Add(name))
                errors.Add($"{prefix}.name \"{name}\" is used by more than one block list - the app fails to reload with a duplicate name.");

            if (list.TryGetPropertyValue("type", out JsonNode? typeNode))
            {
                if (!TryGetString(typeNode, out string type) || !ValidTypes.Contains(type, StringComparer.OrdinalIgnoreCase))
                    errors.Add($"{prefix}.type must be one of: {string.Join(", ", ValidTypes)}.");
            }

            if (list.TryGetPropertyValue("enabled", out JsonNode? enabledNode))
            {
                if (!TryGetScalarKind(enabledNode, out JsonValueKind enabledKind) || (enabledKind != JsonValueKind.True && enabledKind != JsonValueKind.False))
                    errors.Add($"{prefix}.enabled must be a boolean.");
            }

            if (list.TryGetPropertyValue("responseA", out JsonNode? responseANode))
            {
                if (!TryGetString(responseANode, out string responseA) || !IPAddress.TryParse(responseA, out _))
                    errors.Add($"{prefix}.responseA must be a valid IP address - the app fails to reload with an unparseable or null address.");
            }

            if (list.TryGetPropertyValue("responseTXT", out JsonNode? responseTxtNode) && responseTxtNode is not null && !TryGetString(responseTxtNode, out _))
                errors.Add($"{prefix}.responseTXT must be a string when present.");

            if (!list.TryGetPropertyValue("blockListFile", out JsonNode? fileNode) || !TryGetString(fileNode, out string file) || string.IsNullOrWhiteSpace(file))
                errors.Add($"{prefix}.blockListFile is required and must be a non-empty string.");
        }

        return errors;
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
