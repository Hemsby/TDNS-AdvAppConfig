using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class AdvancedBlockingConfigValidator
{
    private static readonly string[] SimpleStringArrayFields =
    [
        "blockingAddresses", "allowed", "blocked", "allowListUrls",
        "allowedRegex", "blockedRegex", "regexAllowListUrls"
    ];

    private static readonly string[] MixedUrlArrayFields =
    [
        "blockListUrls", "regexBlockListUrls", "adblockListUrls"
    ];

    public static List<string> Validate(JsonNode? config)
    {
        List<string> errors = [];

        if (config is not JsonObject root)
        {
            errors.Add("Config must be a JSON object.");
            return errors;
        }

        ValidateOptionalBool(root, "enableBlocking", errors);
        ValidateOptionalNonNegativeNumber(root, "blockingAnswerTtl", errors);
        ValidateOptionalNonNegativeNumber(root, "blockListUrlUpdateIntervalHours", errors);
        ValidateOptionalNonNegativeNumber(root, "blockListUrlUpdateIntervalMinutes", errors);

        ValidateOptionalStringMap(root, "localEndPointGroupMap", errors);

        if (!root.TryGetPropertyValue("networkGroupMap", out JsonNode? networkMapNode) || networkMapNode is not JsonObject networkMap)
            errors.Add("'networkGroupMap' is required and must be an object.");
        else
            ValidateStringMapValues(networkMap, "networkGroupMap", errors);

        if (!root.TryGetPropertyValue("groups", out JsonNode? groupsNode) || groupsNode is not JsonArray groupsArray)
        {
            errors.Add("'groups' is required and must be an array.");
            return errors;
        }

        HashSet<string> seenNames = new(StringComparer.Ordinal);

        for (int i = 0; i < groupsArray.Count; i++)
        {
            string prefix = $"groups[{i}]";

            if (groupsArray[i] is not JsonObject group)
            {
                errors.Add($"{prefix} must be an object.");
                continue;
            }

            if (!group.TryGetPropertyValue("name", out JsonNode? nameNode) || !TryGetString(nameNode, out string name) || string.IsNullOrWhiteSpace(name))
            {
                errors.Add($"{prefix}.name is required and must be a non-empty string.");
            }
            else if (!seenNames.Add(name))
            {
                errors.Add($"{prefix}.name \"{name}\" is used by more than one group - duplicate names will silently shadow each other server-side.");
            }

            ValidateOptionalBool(group, "enableBlocking", errors, prefix);
            ValidateOptionalBool(group, "allowTxtBlockingReport", errors, prefix);
            ValidateOptionalBool(group, "blockAsNxDomain", errors, prefix);

            foreach (string field in SimpleStringArrayFields)
                ValidateOptionalStringArray(group, field, errors, prefix);

            foreach (string field in MixedUrlArrayFields)
                ValidateOptionalUrlEntryArray(group, field, errors, prefix);
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

    private static void ValidateOptionalBool(JsonObject obj, string field, List<string> errors, string? prefix = null)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || (kind != JsonValueKind.True && kind != JsonValueKind.False))
            errors.Add($"{Label(prefix, field)} must be a boolean.");
    }

    private static void ValidateOptionalNonNegativeNumber(JsonObject obj, string field, List<string> errors)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || kind != JsonValueKind.Number)
        {
            errors.Add($"'{field}' must be a number.");
            return;
        }

        if (node!.GetValue<double>() < 0)
            errors.Add($"'{field}' must not be negative.");
    }

    private static void ValidateOptionalStringMap(JsonObject obj, string field, List<string> errors)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (node is not JsonObject mapObj)
        {
            errors.Add($"'{field}' must be an object.");
            return;
        }

        ValidateStringMapValues(mapObj, field, errors);
    }

    private static void ValidateStringMapValues(JsonObject mapObj, string field, List<string> errors)
    {
        foreach (KeyValuePair<string, JsonNode?> kv in mapObj)
        {
            if (string.IsNullOrWhiteSpace(kv.Key))
            {
                errors.Add($"'{field}' has an empty key.");
                continue;
            }

            if (!TryGetString(kv.Value, out string groupName) || string.IsNullOrWhiteSpace(groupName))
                errors.Add($"'{field}[\"{kv.Key}\"]' must map to a non-empty group name string.");
        }
    }

    private static void ValidateOptionalStringArray(JsonObject obj, string field, List<string> errors, string prefix)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (node is not JsonArray array)
        {
            errors.Add($"{Label(prefix, field)} must be an array.");
            return;
        }

        for (int i = 0; i < array.Count; i++)
        {
            if (!TryGetString(array[i], out _))
                errors.Add($"{Label(prefix, field)}[{i}] must be a string.");
        }
    }

    private static void ValidateOptionalUrlEntryArray(JsonObject obj, string field, List<string> errors, string prefix)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (node is not JsonArray array)
        {
            errors.Add($"{Label(prefix, field)} must be an array.");
            return;
        }

        for (int i = 0; i < array.Count; i++)
        {
            JsonNode? item = array[i];

            if (item is null)
            {
                errors.Add($"{Label(prefix, field)}[{i}] must not be null.");
                continue;
            }

            if (TryGetScalarKind(item, out JsonValueKind kind))
            {
                if (kind != JsonValueKind.String)
                    errors.Add($"{Label(prefix, field)}[{i}] must be a URL string or an object with a 'url' field.");

                continue;
            }

            if (item is not JsonObject entryObj)
            {
                errors.Add($"{Label(prefix, field)}[{i}] must be a URL string or an object with a 'url' field.");
                continue;
            }

            if (!entryObj.TryGetPropertyValue("url", out JsonNode? urlNode) || !TryGetString(urlNode, out string url) || string.IsNullOrWhiteSpace(url))
                errors.Add($"{Label(prefix, field)}[{i}].url is required and must be a non-empty string.");

            if (entryObj.TryGetPropertyValue("blockAsNxDomain", out JsonNode? nxNode) && nxNode is not null)
            {
                if (!TryGetScalarKind(nxNode, out JsonValueKind nxKind) || (nxKind != JsonValueKind.True && nxKind != JsonValueKind.False))
                    errors.Add($"{Label(prefix, field)}[{i}].blockAsNxDomain must be a boolean.");
            }

            if (entryObj.TryGetPropertyValue("blockingAddresses", out JsonNode? addrNode) && addrNode is not null)
            {
                if (addrNode is not JsonArray addrArray)
                {
                    errors.Add($"{Label(prefix, field)}[{i}].blockingAddresses must be an array.");
                }
                else
                {
                    for (int j = 0; j < addrArray.Count; j++)
                    {
                        if (!TryGetString(addrArray[j], out _))
                            errors.Add($"{Label(prefix, field)}[{i}].blockingAddresses[{j}] must be a string.");
                    }
                }
            }
        }
    }

    private static string Label(string? prefix, string field) => prefix is null ? $"'{field}'" : $"{prefix}.{field}";
}
