using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class GeoDistanceAppRecordValidator
{
    public static List<string> Validate(JsonObject req, string classPathAddress, string classPathCname)
    {
        List<string> errors = [];

        if (string.IsNullOrWhiteSpace(GetString(req, "domain")))
            errors.Add("'domain' is required.");

        if (string.IsNullOrWhiteSpace(GetString(req, "zone")))
            errors.Add("'zone' is required.");

        string? classPath = GetString(req, "classPath");
        if (classPath != classPathAddress && classPath != classPathCname)
            errors.Add($"'classPath' must be one of: {classPathAddress}, {classPathCname}.");

        if (!req.TryGetPropertyValue("ttl", out JsonNode? ttlNode) || ttlNode is null || !TryGetScalarKind(ttlNode, out JsonValueKind ttlKind) || ttlKind != JsonValueKind.Number || ttlNode.GetValue<double>() < 0)
            errors.Add("'ttl' is required and must be a non-negative number.");

        if (!req.TryGetPropertyValue("data", out JsonNode? dataNode) || dataNode is not JsonArray dataArray)
        {
            errors.Add("'data' is required and must be an array of server entries.");
            return errors;
        }

        if (dataArray.Count == 0)
            errors.Add("'data' must have at least one server entry.");

        bool isAddress = classPath == classPathAddress;

        for (int i = 0; i < dataArray.Count; i++)
        {
            if (dataArray[i] is not JsonObject server)
            {
                errors.Add($"data[{i}] must be an object.");
                continue;
            }

            ValidateLatLong(server, "lat", i, errors);
            ValidateLatLong(server, "long", i, errors);

            if (isAddress)
            {
                if (!server.TryGetPropertyValue("addresses", out JsonNode? addrNode) || addrNode is not JsonArray addresses || addresses.Count == 0)
                {
                    errors.Add($"data[{i}].addresses is required and must be a non-empty array of IP addresses - the app throws mid-query if it's absent.");
                    continue;
                }

                for (int j = 0; j < addresses.Count; j++)
                {
                    if (!TryGetString(addresses[j], out string addr) || !IPAddress.TryParse(addr, out _))
                        errors.Add($"data[{i}].addresses[{j}] must be a valid IP address.");
                }
            }
            else
            {
                if (server.TryGetPropertyValue("cname", out JsonNode? cnameNode) && cnameNode is not null && (!TryGetString(cnameNode, out string cname) || string.IsNullOrWhiteSpace(cname)))
                    errors.Add($"data[{i}].cname must be a non-empty string when present.");
            }
        }

        return errors;
    }

    private static void ValidateLatLong(JsonObject server, string field, int index, List<string> errors)
    {
        if (!server.TryGetPropertyValue(field, out JsonNode? node) || node is null || !TryGetString(node, out string str))
        {
            errors.Add($"data[{index}].{field} is required and must be a string - the app throws mid-query if it's missing or not a string.");
            return;
        }

        if (!double.TryParse(str, NumberStyles.Float, CultureInfo.InvariantCulture, out _))
            errors.Add($"data[{index}].{field} must be a numeric string (e.g. \"19.07283\") - the app throws mid-query for a non-numeric value.");
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
