using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class DropRequestsConfigValidator
{
    public static List<string> Validate(JsonNode? config)
    {
        List<string> errors = [];

        if (config is not JsonObject root)
        {
            errors.Add("Config must be a JSON object.");
            return errors;
        }

        if (!root.TryGetPropertyValue("enableBlocking", out JsonNode? enableNode) || !TryGetScalarKind(enableNode, out JsonValueKind enableKind) || (enableKind != JsonValueKind.True && enableKind != JsonValueKind.False))
            errors.Add("'enableBlocking' is required and must be a boolean.");

        if (root.TryGetPropertyValue("dropMalformedRequests", out JsonNode? dropNode))
        {
            if (!TryGetScalarKind(dropNode, out JsonValueKind dropKind) || (dropKind != JsonValueKind.True && dropKind != JsonValueKind.False))
                errors.Add("'dropMalformedRequests' must be a boolean.");
        }

        ValidateOptionalNetworkArray(root, "allowedNetworks", errors);
        ValidateOptionalNetworkArray(root, "blockedNetworks", errors);
        ValidateOptionalEndPointArray(root, "allowedLocalEndPoints", errors);
        ValidateOptionalBlockedQuestions(root, errors);

        return errors;
    }

    private static void ValidateOptionalNetworkArray(JsonObject root, string field, List<string> errors)
    {
        if (!root.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (node is not JsonArray array)
        {
            errors.Add($"'{field}' must be an array (or null).");
            return;
        }

        for (int i = 0; i < array.Count; i++)
        {
            if (!TryGetString(array[i], out string network) || !NetworkAddressHelper.TryParse(network, out _, out _))
                errors.Add($"{field}[{i}] must be a valid IP address or CIDR range - the app fails to reload with an unparseable entry.");
        }
    }

    private static void ValidateOptionalEndPointArray(JsonObject root, string field, List<string> errors)
    {
        if (!root.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (node is not JsonArray array)
        {
            errors.Add($"'{field}' must be an array (or null).");
            return;
        }

        for (int i = 0; i < array.Count; i++)
        {
            if (!TryGetString(array[i], out string endPoint) || !TryParseEndPoint(endPoint))
                errors.Add($"{field}[{i}] must be a valid IP/domain, optionally with a :port - the app fails to reload with an unparseable entry.");
        }
    }

    private static bool TryParseEndPoint(string value)
    {
        if (IPEndPoint.TryParse(value, out _))
            return true;

        string[] parts = value.Split(':');
        if (parts.Length > 2 || parts[0].Length == 0)
            return false;

        if (IPAddress.TryParse(parts[0], out _))
            return false;

        return parts.Length == 1 || ushort.TryParse(parts[1], out _);
    }

    private static void ValidateOptionalBlockedQuestions(JsonObject root, List<string> errors)
    {
        if (!root.TryGetPropertyValue("blockedQuestions", out JsonNode? node) || node is null)
            return;

        if (node is not JsonArray array)
        {
            errors.Add("'blockedQuestions' must be an array (or null).");
            return;
        }

        for (int i = 0; i < array.Count; i++)
        {
            string prefix = $"blockedQuestions[{i}]";

            if (array[i] is not JsonObject question)
            {
                errors.Add($"{prefix} must be an object.");
                continue;
            }

            if (question.TryGetPropertyValue("name", out JsonNode? nameNode) && nameNode is not null && !TryGetString(nameNode, out _))
                errors.Add($"{prefix}.name must be a string when present.");

            if (question.TryGetPropertyValue("blockZone", out JsonNode? blockZoneNode))
            {
                if (!TryGetScalarKind(blockZoneNode, out JsonValueKind blockZoneKind) || (blockZoneKind != JsonValueKind.True && blockZoneKind != JsonValueKind.False))
                    errors.Add($"{prefix}.blockZone must be a boolean.");
            }

            if (question.TryGetPropertyValue("type", out JsonNode? typeNode))
            {
                if (!TryGetString(typeNode, out string typeName) || !Enum.TryParse(typeName, true, out DnsResourceRecordType _))
                    errors.Add($"{prefix}.type must be a valid DNS record type name - the app fails to reload with an unrecognized or null type.");
            }
        }
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
