using System.Diagnostics;
using System.IO.Compression;
using Microsoft.Extensions.Hosting.WindowsServices;

namespace TdnsAdvAppConfig;

public sealed class UpdateApplier
{
    // Must match install-service.ps1's default -ServiceName. If this process is
    // running as that service, the Updater helper needs to restart it through
    // the Service Control Manager (sc start) rather than launching the exe
    // directly - otherwise the relaunched process would be an unmanaged
    // standalone process while Windows still shows the service as Stopped.
    public const string WindowsServiceName = "TdnsAdvAppConfig";


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
                    // Linux allows replacing a running executable's file on disk; the running
                    // process keeps its old inode open until it exits, so no helper is needed.
                    CopyDirectory(extractDir, installDir);
                    ScheduleSelfExit();
                    return (true, "restarting", "Update staged. Restarting now (systemd Restart=always will bring it back up).");

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
            // Without this, a failure here (can't reach GitHub, disk full, a file locked by
            // antivirus, etc.) is an unhandled exception. Program.cs has no exception-handling
            // middleware, so ASP.NET Core's default response for that is a bare 500 with an
            // empty body - the client's res.json() then fails with "Unexpected end of JSON
            // input", hiding whatever actually went wrong.
            // stagingDir (including extractDir) must survive a success return - the Windows
            // path hands extractDir to a separately-launched helper process that reads it
            // after this method returns - so cleanup only happens here, not in a finally.
            try { Directory.Delete(stagingDir, recursive: true); } catch { /* best effort */ }
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
            File.Copy(file, file.Replace(sourceDir, destDir), overwrite: true);
    }
}
