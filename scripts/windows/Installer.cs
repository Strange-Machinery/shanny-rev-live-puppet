// Per-user self-contained installer. No elevation, downloads, or shell commands.
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

class BuffInstaller {
    const string Magic = "BUFFPK01";
    [STAThread]
    static int Main(string[] args) {
        AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
        AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
        Application.EnableVisualStyles();
        try {
            string self = Assembly.GetExecutingAssembly().Location;
            string folder = Path.GetDirectoryName(self);
            if (File.Exists(Path.Combine(folder, "package-manifest.json"))) {
                Launch(folder); return 0;
            }
            // Test harness uses exactly the same extraction/verification path, no shortcuts or GUI.
            if (args.Length == 2 && args[0] == "--verify-install") {
                string installed = Install(self, Path.GetFullPath(args[1]), delegate(string _) {});
                Shortcut(installed, Path.GetFullPath(args[1]));
                File.WriteAllText(Path.Combine(args[1], "verified-install.txt"), installed);
                return 0;
            }
            using (var mutex = new Mutex(false, "Local\\StrangeMachineryBuffTestingSetup")) {
                if (!mutex.WaitOne(0)) { MessageBox.Show("Setup is already running. Please use that window.", "Buff Testing"); return 0; }
                try {
                    var window = new Form { Text = "Buff Testing — setup", Width = 560, Height = 205,
                        StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog,
                        MaximizeBox = false, MinimizeBox = false };
                    var label = new Label { Left = 24, Top = 20, Width = 500, Height = 65,
                        Text = "Setting up offline testing. This includes speech recognition.\nYou do not need to install anything else." };
                    var progress = new ProgressBar { Left = 24, Top = 98, Width = 490, Style = ProgressBarStyle.Marquee };
                    window.Controls.Add(label); window.Controls.Add(progress);
                    bool complete = false;
                    window.FormClosing += delegate(object sender, FormClosingEventArgs e) { if (!complete) e.Cancel = true; };
                    window.Shown += async delegate {
                        try {
                            string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StrangeMachinery", "BuffTesting");
                            string installed = await Task.Run(() => Install(self, root, message => window.BeginInvoke((Action)(() => label.Text = message))));
                            Shortcut(installed);
                            Process.Start(new ProcessStartInfo(Path.Combine(installed, "Buff Testing.exe")) { UseShellExecute = false });
                        } catch (Exception ex) { MessageBox.Show(window, "Setup could not finish. Reopen this installer to retry.\n\n" + ex.Message, "Buff Testing", MessageBoxButtons.OK, MessageBoxIcon.Error); }
                        complete = true; window.Close();
                    };
                    Application.Run(window);
                } finally { mutex.ReleaseMutex(); }
            }
            return 0;
        } catch (Exception ex) {
            if (args.Length == 2 && args[0] == "--verify-install") {
                Directory.CreateDirectory(args[1]); File.WriteAllText(Path.Combine(args[1], "install-error.txt"), ex.ToString());
            } else MessageBox.Show("Buff Testing could not open. Run the installer again.\n\n" + ex.Message, "Buff Testing");
            return 1;
        }
    }
    static string Hex(byte[] value) { return BitConverter.ToString(value).Replace("-", "").ToLowerInvariant(); }
    static string Install(string self, string root, Action<string> status) {
        string stage = null;
        try {
            using (var input = File.OpenRead(self)) {
                if (input.Length < 48) throw new InvalidDataException("The installer is incomplete. Please obtain the complete file.");
                input.Seek(-48, SeekOrigin.End);
                var reader = new BinaryReader(input);
                long size = reader.ReadInt64(); byte[] digest = reader.ReadBytes(32);
                if (Encoding.ASCII.GetString(reader.ReadBytes(8)) != Magic || size <= 0 || size > input.Length - 48)
                    throw new InvalidDataException("The installer is incomplete. Please obtain the complete file.");
                string version = Hex(digest).Substring(0, 20);
                string releases = Path.Combine(root, "releases");
                Directory.CreateDirectory(releases);
                // Every installation gets a fresh directory. Interrupted and previous versions are never overwritten.
                stage = Path.Combine(releases, version.Substring(0, 8) + "-" + Guid.NewGuid().ToString("N").Substring(0, 8));
                Directory.CreateDirectory(stage);
                var drive = new DriveInfo(Path.GetPathRoot(stage));
                if (drive.AvailableFreeSpace < 2200L * 1024 * 1024) throw new IOException("Free at least 2.2 GB of space, then reopen the installer.");
                string payload = Path.Combine(stage, "payload.zip");
                input.Position = input.Length - 48 - size;
                status("Unpacking offline speech recognition and the app…\nNo internet connection is needed.");
                using (var output = File.Create(payload)) {
                    byte[] buffer = new byte[1024 * 1024]; long remaining = size;
                    while (remaining > 0) { int n = input.Read(buffer, 0, (int)Math.Min(buffer.Length, remaining));
                        if (n == 0) throw new EndOfStreamException(); output.Write(buffer, 0, n); remaining -= n; }
                }
                using (var sha = SHA256.Create()) using (var file = File.OpenRead(payload))
                    if (Hex(sha.ComputeHash(file)) != Hex(digest)) throw new InvalidDataException("Installer integrity check failed. Obtain a fresh copy.");
                using (var zip = ZipFile.OpenRead(payload)) {
                    string prefix = Path.GetFullPath(stage) + Path.DirectorySeparatorChar;
                    foreach (var entry in zip.Entries) {
                        string target = Path.GetFullPath(Path.Combine(stage, entry.FullName));
                        if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || entry.FullName.Contains(":"))
                            throw new InvalidDataException("Invalid package path.");
                        if (entry.FullName.EndsWith("/")) { Directory.CreateDirectory(target); continue; }
                        Directory.CreateDirectory(Path.GetDirectoryName(target)); entry.ExtractToFile(target, false);
                    }
                }
                File.Delete(payload);
                status("Checking speech recognition and the included runtimes…\nThe app will open automatically when ready.");
                Check(stage);
                File.WriteAllText(Path.Combine(stage, "installed.txt"), version);
                return stage;
            }
        } catch {
            // Keep incomplete installs for diagnosis. No current or older installation is deleted.
            throw;
        }
    }
    static ProcessStartInfo Python(string root, bool windowless, string script) {
        var info = new ProcessStartInfo(Path.Combine(root, "runtime", "python", windowless ? "pythonw.exe" : "python.exe"), "-I \"" + Path.Combine(root, "app", "python", script) + "\"");
        info.WorkingDirectory = root; info.UseShellExecute = false; info.CreateNoWindow = true;
        info.EnvironmentVariables.Remove("PYTHONHOME"); info.EnvironmentVariables.Remove("PYTHONPATH");
        info.EnvironmentVariables["HF_HUB_OFFLINE"] = "1"; info.EnvironmentVariables["TRANSFORMERS_OFFLINE"] = "1";
        return info;
    }
    static void Check(string root) {
        var info = Python(root, false, "bundle_check.py");
        info.RedirectStandardOutput = true; info.RedirectStandardError = true;
        using (var process = Process.Start(info)) {
            var stdout = process.StandardOutput.ReadToEndAsync(); var stderr = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(120000)) { process.Kill(); throw new IOException("The readiness check timed out. Reopen setup after other heavy applications finish."); }
            Task.WaitAll(stdout, stderr);
            File.WriteAllText(Path.Combine(root, "readiness.txt"), stdout.Result + stderr.Result);
            if (process.ExitCode != 0) throw new IOException("An included runtime did not pass its readiness check. Please send the readiness.txt file in " + root + " to the producer.");
        }
    }
    static void Launch(string root) {
        // The tiny installed launcher stays alive and owns the single-instance mutex until the UI closes.
        using (var mutex = new Mutex(false, "Local\\StrangeMachineryBuffTestingApp")) {
            if (!mutex.WaitOne(0)) { MessageBox.Show("Buff Testing is already open. Select its window on the taskbar.", "Buff Testing"); return; }
            try {
                using (var process = Process.Start(Python(root, true, "bundle_entry.py"))) {
                    process.WaitForExit();
                    if (process.ExitCode != 0) throw new IOException("The app exited unexpectedly. Reopen the installer to repair it.");
                }
            } finally { mutex.ReleaseMutex(); }
        }
    }
    static void Shortcut(string root, string testDestination = null) {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        object shell = Activator.CreateInstance(shellType);
        string[] destinations = testDestination != null ? new string[] { testDestination } : new string[] {
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs") };
        foreach (string destination in destinations) {
            Directory.CreateDirectory(destination);
            object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { Path.Combine(destination, "Buff Testing.lnk") });
            Type type = shortcut.GetType();
            type.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { Path.Combine(root, "Buff Testing.exe") });
            type.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { root });
            type.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "Private offline microphone and donation testing" });
            type.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
        }
    }
}
