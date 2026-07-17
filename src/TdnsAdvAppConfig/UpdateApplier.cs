using System.Diagnostics;
using System.IO.Compression;
using Microsoft.Extensions.Hosting.WindowsServices;

namespace TdnsAdvAppConfig;

public sealed class UpdateApplier
{
    public const string WindowsServiceName = "TdnsAdvAppConfig";

    private const string LinuxExeName = "TdnsAdvAppConfig";

    public async Task<(bool success, string status, string? message)> ApplyAsync(string downloadUrl, string installDir, CancellationToken ct)
    {
        DeploymentKind kind = DeploymentDetector.Detect();

        if (kind == DeploymentKind.Docker)
            return (false, "docker", "Docker deployments update via: docker compose pull && docker compose up -d (run on the host).");

        string stagingDir = Path.Combine(Path.GetTempPath(), "tdns-advappconfig-update-" + Guid.NewGuid());

        try
        {
            Directory.CreateDirectory(stagingDir);

            string zipPath = Path.Combine(stagingDir, "update.zip");
            using (HttpClient http = new HttpClient())
            {
                byte[] data = await http.GetByteArrayAsync(downloadUrl, ct);
                await File.WriteAllBytesAsync(zipPath, data, ct);
            }

            string extractDir = Path.Combine(stagingDir, "extracted");
            ZipFile.ExtractToDirectory(zipPath, extractDir);

            switch (kind)
            {
                case DeploymentKind.Systemd:
                    {
                        string extractedExe = Path.Combine(extractDir, LinuxExeName);
                        if (!File.Exists(extractedExe))
                        {
                            return (false, "error", $"Downloaded release is missing the expected executable ({LinuxExeName}).");
                        }

                        if (OperatingSystem.IsLinux())
                        {
                            File.SetUnixFileMode(extractedExe,
                                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute |
                                UnixFileMode.GroupRead | UnixFileMode.GroupExecute |
                                UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
                        }

                        CopyDirectory(extractDir, installDir);
                        ScheduleSelfExit();
                        return (true, "restarting", "Update staged. Restarting now (systemd Restart=always will bring it back up).");
                    }

                case DeploymentKind.Windows:
                    {
                        string updaterExe = Path.Combine(AppContext.BaseDirectory, "TdnsAdvAppConfig.Updater.exe");
                        if (!File.Exists(updaterExe))
                            return (false, "error", "Updater helper (TdnsAdvAppConfig.Updater.exe) was not found next to the main executable.");

                        int pid = Environment.ProcessId;
                        string exeName = Path.GetFileName(Environment.ProcessPath) ?? "TdnsAdvAppConfig.exe";

                        ProcessStartInfo psi = new ProcessStartInfo(updaterExe)
                        {
                            UseShellExecute = false,
                            WorkingDirectory = AppContext.BaseDirectory
                        };
                        psi.ArgumentList.Add(pid.ToString());
                        psi.ArgumentList.Add(extractDir);
                        psi.ArgumentList.Add(installDir);
                        psi.ArgumentList.Add(exeName);

                        if (WindowsServiceHelpers.IsWindowsService())
                        {
                            psi.ArgumentList.Add("--service");
                            psi.ArgumentList.Add(WindowsServiceName);
                        }

                        Process.Start(psi);
                        ScheduleSelfExit();
                        return (true, "restarting", "Update staged. Restarting now via helper process.");
                    }

                default:
                    return (false, "error", "Unknown deployment type.");
            }
        }
        catch (Exception ex)
        {
            try { Directory.Delete(stagingDir, recursive: true); } catch { }
            return (false, "error", ex.Message);
        }
    }

    private static void ScheduleSelfExit()
    {
        _ = Task.Run(async () =>
        {
            await Task.Delay(500);
            Environment.Exit(0);
        });
    }

    private static void CopyDirectory(string sourceDir, string destDir)
    {
        foreach (string dir in Directory.GetDirectories(sourceDir, "*", SearchOption.AllDirectories))
            Directory.CreateDirectory(dir.Replace(sourceDir, destDir));

        foreach (string file in Directory.GetFiles(sourceDir, "*", SearchOption.AllDirectories))
        {
            string destFile = file.Replace(sourceDir, destDir);

            string tempFile = destFile + ".update-tmp";
            File.Copy(file, tempFile, overwrite: true);

            if (OperatingSystem.IsLinux())
                File.SetUnixFileMode(tempFile, File.GetUnixFileMode(file));

            File.Move(tempFile, destFile, overwrite: true);
        }
    }
}
