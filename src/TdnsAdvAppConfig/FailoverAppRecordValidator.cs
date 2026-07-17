using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class FailoverAppRecordValidator
{
    public static List<string> ValidateAddress(JsonObject req)
    {
        List<string> errors = [];

        ValidateCommonFields(req, errors);

        if (!req.TryGetPropertyValue("data", out JsonNode? dataNode) || dataNode is not JsonObject dataObj)
        {
            errors.Add("'data' is required and must be an object.");
            return errors;
        }

        if (!dataObj.TryGetPropertyValue("primary", out JsonNode? primaryNode) || primaryNode is not JsonArray primary || primary.Count == 0)
            errors.Add("'data.primary' is required and must be a non-empty array of IP addresses.");
        else
            ValidateIpArray(primary, "data.primary", errors);

        ValidateOptionalIpArray(dataObj, "secondary", errors);
        ValidateOptionalIpArray(dataObj, "serverDown", errors);

        return errors;
    }

    public static List<string> ValidateCname(JsonObject req)
    {
        List<string> errors = [];

        ValidateCommonFields(req, errors);

        if (!req.TryGetPropertyValue("data", out JsonNode? dataNode) || dataNode is not JsonObject dataObj)
        {
            errors.Add("'data' is required and must be an object.");
            return errors;
        }

        if (!TryGetString(dataObj.TryGetPropertyValue("primary", out JsonNode? primaryNode) ? primaryNode : null, out string primary) || string.IsNullOrWhiteSpace(primary))
            errors.Add("'data.primary' is required and must be a non-empty domain name string.");

        if (dataObj.TryGetPropertyValue("secondary", out JsonNode? secondaryNode) && secondaryNode is not null)
        {
            if (secondaryNode is not JsonArray secondary)
            {
                errors.Add("'data.secondary' must be an array of domain name strings when present.");
            }
            else
            {
                for (int i = 0; i < secondary.Count; i++)
                {
                    if (!TryGetString(secondary[i], out string domain) || string.IsNullOrWhiteSpace(domain))
                        errors.Add($"data.secondary[{i}] must be a non-empty domain name string.");
                }
            }
        }

        if (dataObj.TryGetPropertyValue("serverDown", out JsonNode? serverDownNode) && serverDownNode is not null)
        {
            if (!TryGetString(serverDownNode, out string serverDown) || string.IsNullOrWhiteSpace(serverDown))
                errors.Add("'data.serverDown' must be a non-empty domain name string when present.");
        }

        return errors;
    }

    private static void ValidateCommonFields(JsonObject req, List<string> errors)
    {
        if (string.IsNullOrWhiteSpace(GetString(req, "domain")))
            errors.Add("'domain' is required.");

        if (string.IsNullOrWhiteSpace(GetString(req, "zone")))
            errors.Add("'zone' is required.");

        if (!req.TryGetPropertyValue("ttl", out JsonNode? ttlNode) || ttlNode is null || !TryGetScalarKind(ttlNode, out JsonValueKind ttlKind) || ttlKind != JsonValueKind.Number || ttlNode.GetValue<double>() < 0)
            errors.Add("'ttl' is required and must be a non-negative number.");

        if (!req.TryGetPropertyValue("data", out JsonNode? dataNode) || dataNode is not JsonObject dataObj)
            return;

        if (!dataObj.TryGetPropertyValue("healthCheck", out JsonNode? healthCheckNode) || !TryGetString(healthCheckNode, out string healthCheck) || string.IsNullOrWhiteSpace(healthCheck))
            errors.Add("'data.healthCheck' is required and must be a non-empty string - every query throws otherwise.");

        if (dataObj.TryGetPropertyValue("healthCheckUrl", out JsonNode? urlNode) && urlNode is not null && TryGetString(urlNode, out string url) && !Uri.TryCreate(url, UriKind.Absolute, out _))
            errors.Add("'data.healthCheckUrl' must be a valid absolute URL when present as a string.");

        if (dataObj.TryGetPropertyValue("allowTxtStatus", out JsonNode? txtNode))
        {
            if (!TryGetScalarKind(txtNode, out JsonValueKind txtKind) || (txtKind != JsonValueKind.True && txtKind != JsonValueKind.False))
                errors.Add("'data.allowTxtStatus' must be a boolean when present.");
        }
    }

    private static void ValidateIpArray(JsonArray array, string label, List<string> errors)
    {
        for (int i = 0; i < array.Count; i++)
        {
            if (!TryGetString(array[i], out string addr) || !IPAddress.TryParse(addr, out _))
                errors.Add($"{label}[{i}] must be a valid IP address - the app throws mid-query for an unparseable entry.");
        }
    }

    private static void ValidateOptionalIpArray(JsonObject dataObj, string field, List<string> errors)
    {
        if (!dataObj.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (node is not JsonArray array)
        {
            errors.Add($"'data.{field}' must be an array of IP addresses when present.");
            return;
        }

        ValidateIpArray(array, $"data.{field}", errors);
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
