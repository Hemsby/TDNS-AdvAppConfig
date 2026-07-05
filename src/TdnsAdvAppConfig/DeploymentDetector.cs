namespace TdnsAdvAppConfig;

public enum DeploymentKind { Windows, Systemd, Docker }

public static class DeploymentDetector
{
    public static DeploymentKind Detect()
    {
        if (File.Exists("/.dockerenv"))
            return DeploymentKind.Docker;

        if (OperatingSystem.IsWindows())
            return DeploymentKind.Windows;

        return DeploymentKind.Systemd;
    }
}
