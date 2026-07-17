using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class WildIpAppRecordValidator
{
    public static List<string> Validate(JsonObject req)
    {
        List<string> errors = [];

        if (string.IsNullOrWhiteSpace(GetString(req, "domain")))
            errors.Add("'domain' is required.");

        if (string.IsNullOrWhiteSpace(GetString(req, "zone")))
            errors.Add("'zone' is required.");

        if (!req.TryGetPropertyValue("ttl", out JsonNode? ttlNode) || ttlNode is null || !TryGetScalarKind(ttlNode, out JsonValueKind ttlKind) || ttlKind != JsonValueKind.Number || ttlNode.GetValue<double>() < 0)
            errors.Add("'ttl' is required and must be a non-negative number.");

        if (!req.TryGetPropertyValue("data", out JsonNode? dataNode) || dataNode is not JsonObject dataObj)
        {
            errors.Add("'data' is required and must be an object.");
            return errors;
        }

        if (dataObj.TryGetPropertyValue("allowedNetworks", out JsonNode? networksNode))
        {
            if (networksNode is not JsonArray networksArray)
            {
                errors.Add("data.allowedNetworks must be an array when present - the app fails on every query with a null or non-array value.");
            }
            else
            {
                for (int i = 0; i < networksArray.Count; i++)
                {
                    if (!TryGetString(networksArray[i], out string network) || !NetworkAddressHelper.TryParse(network, out _, out _))
                        errors.Add($"data.allowedNetworks[{i}] must be a valid IP address or CIDR range - the app fails on every query with an unparseable entry.");
                }
            }
        }

        return errors;
    }

    private static string? GetString(JsonObject obj, string field)
    {
        return obj.TryGetPropertyValue(field, out JsonNode? node) && TryGetString(node, out string value) ? value : null;
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
