using System.Net.Mail;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace TdnsAdvAppConfig;

public static class FailoverConfigValidator
{
    private static readonly string[] ValidHealthCheckTypes = ["Unknown", "Ping", "Tcp", "Http", "Https"];

    public static List<string> Validate(JsonNode? config)
    {
        List<string> errors = [];

        if (config is not JsonObject root)
        {
            errors.Add("Config must be a JSON object.");
            return errors;
        }

        ValidateHealthChecks(root, errors);
        ValidateEmailAlerts(root, errors);
        ValidateWebHooks(root, errors);
        ValidateUnderMaintenance(root, errors);

        return errors;
    }

    private static void ValidateHealthChecks(JsonObject root, List<string> errors)
    {
        if (!root.TryGetPropertyValue("healthChecks", out JsonNode? node) || node is not JsonArray array)
        {
            errors.Add("'healthChecks' is required and must be an array - the app throws on every reload if it's missing or the wrong type.");
            return;
        }

        HashSet<string> seenNames = new(StringComparer.Ordinal);

        for (int i = 0; i < array.Count; i++)
        {
            string prefix = $"healthChecks[{i}]";

            if (array[i] is not JsonObject hc)
            {
                errors.Add($"{prefix} must be an object.");
                continue;
            }

            ValidateNameField(hc, prefix, "health check", seenNames, errors);

            if (hc.TryGetPropertyValue("type", out JsonNode? typeNode))
            {
                if (!TryGetString(typeNode, out string type) || !ValidHealthCheckTypes.Contains(type, StringComparer.OrdinalIgnoreCase))
                    errors.Add($"{prefix}.type must be one of: ping, tcp, http, https - the app throws on reload for anything else (including a present null).");
            }

            ValidateOptionalInt(hc, "interval", prefix, errors);
            ValidateOptionalInt(hc, "retries", prefix, errors);
            ValidateOptionalInt(hc, "timeout", prefix, errors);
            ValidateOptionalInt(hc, "port", prefix, errors);

            ValidateOptionalUrl(hc, "url", prefix, errors);

        }
    }

    private static void ValidateEmailAlerts(JsonObject root, List<string> errors)
    {
        if (!root.TryGetPropertyValue("emailAlerts", out JsonNode? node) || node is not JsonArray array)
        {
            errors.Add("'emailAlerts' is required and must be an array - the app throws on every reload if it's missing or the wrong type.");
            return;
        }

        HashSet<string> seenNames = new(StringComparer.Ordinal);

        for (int i = 0; i < array.Count; i++)
        {
            string prefix = $"emailAlerts[{i}]";

            if (array[i] is not JsonObject ea)
            {
                errors.Add($"{prefix} must be an object.");
                continue;
            }

            ValidateNameField(ea, prefix, "email alert", seenNames, errors);

            ValidateOptionalBool(ea, "enabled", prefix, errors);
            ValidateOptionalEmailArray(ea, "alertTo", prefix, errors);
            ValidateOptionalNullableString(ea, "smtpServer", prefix, errors);
            ValidateOptionalInt(ea, "smtpPort", prefix, errors);
            ValidateOptionalBool(ea, "startTls", prefix, errors);
            ValidateOptionalBool(ea, "smtpOverTls", prefix, errors);
            ValidateOptionalNullableString(ea, "username", prefix, errors);
            ValidateOptionalNullableString(ea, "password", prefix, errors);

            ValidateOptionalEmail(ea, "mailFrom", prefix, errors);
            ValidateOptionalNullableString(ea, "mailFromName", prefix, errors);
        }
    }

    private static void ValidateWebHooks(JsonObject root, List<string> errors)
    {
        if (!root.TryGetPropertyValue("webHooks", out JsonNode? node) || node is not JsonArray array)
        {
            errors.Add("'webHooks' is required and must be an array - the app throws on every reload if it's missing or the wrong type.");
            return;
        }

        HashSet<string> seenNames = new(StringComparer.Ordinal);

        for (int i = 0; i < array.Count; i++)
        {
            string prefix = $"webHooks[{i}]";

            if (array[i] is not JsonObject wh)
            {
                errors.Add($"{prefix} must be an object.");
                continue;
            }

            ValidateNameField(wh, prefix, "webhook", seenNames, errors);

            ValidateOptionalBool(wh, "enabled", prefix, errors);
            ValidateOptionalUrlArray(wh, "urls", prefix, errors);
        }
    }

    private static void ValidateUnderMaintenance(JsonObject root, List<string> errors)
    {
        if (!root.TryGetPropertyValue("underMaintenance", out JsonNode? node) || node is null)
            return;

        if (node is not JsonArray array)
        {
            errors.Add("'underMaintenance' must be an array when present - the app throws on reload for anything else, including a present null.");
            return;
        }

        for (int i = 0; i < array.Count; i++)
        {
            string prefix = $"underMaintenance[{i}]";

            if (array[i] is not JsonObject entry)
            {
                errors.Add($"{prefix} must be an object.");
                continue;
            }

            if (!entry.TryGetPropertyValue("network", out JsonNode? networkNode) || !TryGetString(networkNode, out string network) || !NetworkAddressHelper.TryParse(network, out _, out _))
                errors.Add($"{prefix}.network is required and must be a valid IP address or CIDR range - the app throws on reload otherwise.");

            if (entry.TryGetPropertyValue("enabled", out JsonNode? enabledNode))
            {
                if (!TryGetScalarKind(enabledNode, out JsonValueKind kind) || (kind != JsonValueKind.True && kind != JsonValueKind.False))
                    errors.Add($"{prefix}.enabled must be a boolean when present.");
            }
            else if (entry.TryGetPropertyValue("enable", out JsonNode? enableNode))
            {
                if (!TryGetScalarKind(enableNode, out JsonValueKind kind) || (kind != JsonValueKind.True && kind != JsonValueKind.False))
                    errors.Add($"{prefix}.enable must be a boolean when present.");
            }
        }
    }

    private static void ValidateNameField(JsonObject obj, string prefix, string noun, HashSet<string> seenNames, List<string> errors)
    {
        string name = "default";

        if (obj.TryGetPropertyValue("name", out JsonNode? nameNode))
        {
            if (!TryGetString(nameNode, out name) || string.IsNullOrEmpty(name))
            {
                errors.Add($"{prefix}.name must be a non-empty string when present - the app crashes on reload otherwise.");
                return;
            }
        }

        if (!seenNames.Add(name))
            errors.Add($"{prefix}.name \"{name}\" is used by more than one {noun} - duplicates silently overwrite each other server-side.");
    }

    private static void ValidateOptionalBool(JsonObject obj, string field, string prefix, List<string> errors)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node))
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || (kind != JsonValueKind.True && kind != JsonValueKind.False))
            errors.Add($"{prefix}.{field} must be a boolean - the app throws on reload otherwise (including a present null).");
    }

    private static void ValidateOptionalInt(JsonObject obj, string field, string prefix, List<string> errors)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node))
            return;

        if (!TryGetScalarKind(node, out JsonValueKind kind) || kind != JsonValueKind.Number || !node!.GetValue<JsonElement>().TryGetInt32(out _))
            errors.Add($"{prefix}.{field} must be a whole number - the app throws on reload otherwise (including a present null).");
    }

    private static void ValidateOptionalUrl(JsonObject obj, string field, string prefix, List<string> errors)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (!TryGetString(node, out string url))
            return;

        if (!Uri.TryCreate(url, UriKind.Absolute, out _))
            errors.Add($"{prefix}.{field} must be a valid absolute URL when present as a string - the app throws on reload/query for an unparseable one.");
    }

    private static void ValidateOptionalUrlArray(JsonObject obj, string field, string prefix, List<string> errors)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (node is not JsonArray array)
        {
            errors.Add($"{prefix}.{field} must be an array when present.");
            return;
        }

        for (int i = 0; i < array.Count; i++)
        {
            if (!TryGetString(array[i], out string url) || !Uri.TryCreate(url, UriKind.Absolute, out _))
                errors.Add($"{prefix}.{field}[{i}] must be a valid absolute URL - the app throws on reload for an unparseable entry.");
        }
    }

    private static void ValidateOptionalEmailArray(JsonObject obj, string field, string prefix, List<string> errors)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (node is not JsonArray array)
        {
            errors.Add($"{prefix}.{field} must be an array when present.");
            return;
        }

        for (int i = 0; i < array.Count; i++)
        {
            if (!TryGetString(array[i], out string email) || !IsValidEmail(email))
                errors.Add($"{prefix}.{field}[{i}] must be a valid email address - the app throws on reload for an unparseable entry.");
        }
    }

    private static void ValidateOptionalEmail(JsonObject obj, string field, string prefix, List<string> errors)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (!TryGetString(node, out string email))
            return;

        if (!IsValidEmail(email))
            errors.Add($"{prefix}.{field} must be a valid email address when present as a string - the app throws on reload for an unparseable one.");
    }

    private static void ValidateOptionalNullableString(JsonObject obj, string field, string prefix, List<string> errors)
    {
        if (!obj.TryGetPropertyValue(field, out JsonNode? node) || node is null)
            return;

        if (!TryGetString(node, out _))
            errors.Add($"{prefix}.{field} must be a string or null when present.");
    }

    private static bool IsValidEmail(string email)
    {
        try
        {
            _ = new MailAddress(email);
            return true;
        }
        catch (FormatException)
        {
            return false;
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
