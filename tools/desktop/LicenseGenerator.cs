using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class Bridge {
    public static Dictionary<string, object> Call(Dictionary<string, object> input) {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        var start = new ProcessStartInfo(Path.Combine(root, "node.exe"), "\"" + Path.Combine(root, "tools", "desktop", "bridge.mjs") + "\"");
        start.UseShellExecute = false; start.CreateNoWindow = true;
        start.RedirectStandardInput = true; start.RedirectStandardOutput = true; start.RedirectStandardError = true;
        start.StandardOutputEncoding = Encoding.UTF8; start.StandardErrorEncoding = Encoding.UTF8;
        var json = new JavaScriptSerializer();
        using (var process = Process.Start(start)) {
            byte[] request = new UTF8Encoding(false).GetBytes(json.Serialize(input));
            process.StandardInput.BaseStream.Write(request,0,request.Length); process.StandardInput.BaseStream.Flush(); process.StandardInput.Close();
            string output = process.StandardOutput.ReadToEnd();
            string error = process.StandardError.ReadToEnd();
            process.WaitForExit();
            if (String.IsNullOrWhiteSpace(output)) throw new Exception("运行授权工具失败：" + error);
            var result = json.Deserialize<Dictionary<string, object>>(output);
            if (!(bool)result["ok"]) throw new Exception(Convert.ToString(result["error"]));
            if (process.ExitCode != 0) throw new Exception("授权工具未正常退出");
            return result;
        }
    }
}

sealed class GeneratorForm : Form {
    TextBox keyPath, publicKey, machine, extra, preview;
    CheckBox permanent;
    DateTimePicker expiration;
    Label compatibility, resultLabel;
    string expectedPublic;
    readonly string settings = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LaErpLicenseGenerator", "private-key-path.txt");
    public GeneratorForm() {
        Text = "LA-ERP 授权生成器"; ClientSize = new Size(850, 735);
        Font = new Font("Microsoft YaHei UI", 10); BackColor = Color.FromArgb(245, 247, 250);
        StartPosition = FormStartPosition.CenterScreen; FormBorderStyle = FormBorderStyle.FixedSingle; MaximizeBox = false;
        var header = new Panel { Bounds = new Rectangle(0,0,850,86), BackColor = Color.FromArgb(25,45,70) }; Controls.Add(header);
        header.Controls.Add(new Label { Text = "LA-ERP 授权生成器", ForeColor = Color.White, Font = new Font(Font.FontFamily,20,FontStyle.Bold), Bounds = new Rectangle(24,13,790,36) });
        header.Controls.Add(new Label { Text = "在本机签发专业版授权 · 支持永久或指定到期时间", ForeColor = Color.FromArgb(210,225,240), Bounds = new Rectangle(26,54,790,25) });
        LabelAt("1  选择签发私钥",24,102,300);
        keyPath = TextAt(24,132,585,31); keyPath.ReadOnly = true;
        ButtonAt("选择私钥…",620,130,100,34,delegate { SelectKey(); });
        ButtonAt("新建密钥…",730,130,96,34,delegate { CreateKeys(); });
        LabelAt("公钥",24,180,50);
        publicKey = TextAt(79,177,747,30); publicKey.ReadOnly = true;
        compatibility = LabelAt("请选择已有私钥；本次恢复包使用的是已经生成的那一对密钥。",24,217,802);
        compatibility.ForeColor = Color.FromArgb(65,85,105);
        LabelAt("2  填写授权信息",24,259,400);
        LabelAt("机器码",24,295,100);
        machine = TextAt(124,291,702,32); machine.MaxLength = 64;
        LabelAt("复制飞牛 ERP 授权页面上的 64 位机器码。",124,332,702).ForeColor = Color.FromArgb(100,110,120);
        LabelAt("有效期",24,375,100);
        permanent = new CheckBox { Text="永久授权", Checked=true, Bounds=new Rectangle(124,373,135,30) }; Controls.Add(permanent);
        expiration = new DateTimePicker { Bounds=new Rectangle(270,372,290,32), Format=DateTimePickerFormat.Custom, CustomFormat="yyyy-MM-dd HH:mm:ss", Value=DateTime.Now.AddYears(1), Enabled=false }; Controls.Add(expiration);
        LabelAt("到期时间采用本机时区",575,378,251).ForeColor = Color.FromArgb(100,110,120);
        permanent.CheckedChanged += delegate { expiration.Enabled = !permanent.Checked; };
        LabelAt("备注",24,423,100); extra = TextAt(124,418,702,32); extra.MaxLength = 2000;
        var generate = ButtonAt("生成并保存授权文件…",24,477,275,43,delegate { Generate(); });
        generate.BackColor=Color.FromArgb(30,100,180); generate.ForeColor=Color.White; generate.FlatStyle=FlatStyle.Flat;
        ButtonAt("打开密钥目录",314,477,160,43,delegate { if(File.Exists(keyPath.Text)) Process.Start("explorer.exe", "\""+Path.GetDirectoryName(keyPath.Text)+"\""); else MessageBox.Show(this,"请先选择私钥。","提示"); });
        resultLabel=LabelAt("导出的 license.key 可在 ERP 授权页面上传。",24,534,802);
        preview=TextAt(24,566,802,138); preview.Multiline=true; preview.ReadOnly=true; preview.ScrollBars=ScrollBars.Vertical; preview.Font=new Font("Consolas",9);
        LabelAt("私钥仅在本机读取，不通过网络传输。新密钥需同步更新安装包公钥。",24,710,802).ForeColor=Color.FromArgb(100,110,120);
        string expected=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"recovery-public.key");
        if(File.Exists(expected)) expectedPublic=File.ReadAllText(expected).Trim();
        Shown += delegate {
            try {
                string local=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"..","keys","private.pem"));
                if(File.Exists(settings) && File.Exists(File.ReadAllText(settings).Trim())) LoadKey(File.ReadAllText(settings).Trim());
                else if(File.Exists(local)) LoadKey(local);
            } catch(Exception ex) { MessageBox.Show(this,ex.Message,"加载私钥失败"); }
        };
    }
    Label LabelAt(string text,int x,int y,int width) { var c=new Label { Text=text,Bounds=new Rectangle(x,y,width,27) }; Controls.Add(c); return c; }
    TextBox TextAt(int x,int y,int width,int height) { var c=new TextBox { Bounds=new Rectangle(x,y,width,height) }; Controls.Add(c); return c; }
    Button ButtonAt(string text,int x,int y,int width,int height,EventHandler handler) { var c=new Button { Text=text,Bounds=new Rectangle(x,y,width,height),UseVisualStyleBackColor=true }; c.Click+=handler; Controls.Add(c); return c; }
    void LoadKey(string filename) {
        var data=Bridge.Call(new Dictionary<string,object>{{"action","info"},{"privatePath",filename}});
        keyPath.Text=filename; publicKey.Text=Convert.ToString(data["publicText"]);
        bool matches=publicKey.Text==expectedPublic;
        compatibility.Text=matches ? "✓ 此私钥与已上传的恢复安装包匹配，可以直接签发授权。" : "此密钥为另一对密钥：请先用对应公钥重新生成恢复安装包。";
        compatibility.ForeColor=matches ? Color.FromArgb(25,125,75) : Color.FromArgb(170,95,20);
        Directory.CreateDirectory(Path.GetDirectoryName(settings)); File.WriteAllText(settings,filename,Encoding.UTF8);
    }
    void SelectKey() {
        using(var dialog=new OpenFileDialog { Title="选择签发私钥 private.pem",Filter="PEM 私钥 (*.pem)|*.pem|所有文件 (*.*)|*.*" }) {
            if(dialog.ShowDialog(this)!=DialogResult.OK)return;
            try { LoadKey(dialog.FileName); } catch(Exception ex) { MessageBox.Show(this,ex.Message,"无法加载私钥",MessageBoxButtons.OK,MessageBoxIcon.Error); }
        }
    }
    void CreateKeys() {
        using(var dialog=new FolderBrowserDialog { Description="选择存放新密钥的目录；不会覆盖已有 private.pem 或 public.key" }) {
            if(dialog.ShowDialog(this)!=DialogResult.OK)return;
            try {
                var data=Bridge.Call(new Dictionary<string,object>{{"action","keygen"},{"directory",dialog.SelectedPath}});
                LoadKey(Convert.ToString(data["privatePath"]));
                MessageBox.Show(this,"新密钥已生成。请备份 private.pem；使用这对密钥时，需要同步替换安装包中的公钥。","密钥已保存",MessageBoxButtons.OK,MessageBoxIcon.Information);
            } catch(Exception ex) { MessageBox.Show(this,ex.Message,"生成密钥失败",MessageBoxButtons.OK,MessageBoxIcon.Error); }
        }
    }
    void Generate() {
        if(!File.Exists(keyPath.Text)) { MessageBox.Show(this,"请先选择签发私钥。","提示"); return; }
        if(!System.Text.RegularExpressions.Regex.IsMatch(machine.Text.Trim(),"^[a-f0-9]{64}$")) { MessageBox.Show(this,"机器码必须为 64 位小写十六进制，请从 ERP 授权页面复制。","机器码无效"); return; }
        using(var dialog=new SaveFileDialog { Title="保存授权文件",Filter="授权文件 (*.key)|*.key",FileName="license.key",OverwritePrompt=false }) {
            if(dialog.ShowDialog(this)!=DialogResult.OK)return;
            if(File.Exists(dialog.FileName)) { MessageBox.Show(this,"文件已存在，请使用一个新文件名。","不会覆盖已有授权"); return; }
            try {
                string expires=permanent.Checked ? "" : new DateTimeOffset(DateTime.SpecifyKind(expiration.Value,DateTimeKind.Local)).ToString("yyyy-MM-dd'T'HH:mm:sszzz");
                var data=Bridge.Call(new Dictionary<string,object>{{"action","sign"},{"privatePath",keyPath.Text},{"machine",machine.Text.Trim()},{"expires",expires},{"extra",extra.Text.Trim()},{"output",dialog.FileName}});
                preview.Text=File.ReadAllText(dialog.FileName,Encoding.UTF8);
                resultLabel.Text="✓ 签名校验通过，已保存："+Convert.ToString(data["output"]); resultLabel.ForeColor=Color.FromArgb(25,125,75);
                MessageBox.Show(this,"授权已生成并完成签名校验。\n\n在 ERP 授权页面上传：\n"+dialog.FileName,"授权生成成功",MessageBoxButtons.OK,MessageBoxIcon.Information);
            } catch(Exception ex) { MessageBox.Show(this,ex.Message,"生成授权失败",MessageBoxButtons.OK,MessageBoxIcon.Error); }
        }
    }
    public void RenderPreview(string filename) { machine.Text=new string('a',64); using(var image=new Bitmap(Width,Height)) { DrawToBitmap(image,new Rectangle(0,0,Width,Height)); image.Save(filename,System.Drawing.Imaging.ImageFormat.Png); } }
}

static class Program {
    [STAThread] static int Main(string[] args) {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        try {
            if(args.Length==2 && args[0]=="--preview") { using(var form=new GeneratorForm()) { form.Opacity=0; form.Show(); Application.DoEvents(); form.RenderPreview(args[1]); form.Close(); } return 0; }
            if(args.Length==1 && args[0]=="--self-test") {
                string dir=Path.Combine(Path.GetTempPath(),"授权测试-"+Guid.NewGuid().ToString("N"));
                try {
                    var pair=Bridge.Call(new Dictionary<string,object>{{"action","keygen"},{"directory",dir}});
                    string pem=Convert.ToString(pair["privatePath"]);
                    var info=Bridge.Call(new Dictionary<string,object>{{"action","info"},{"privatePath",pem}});
                    if(Convert.ToString(info["publicText"])!=Convert.ToString(pair["publicText"]))throw new Exception("公钥不一致");
                    Bridge.Call(new Dictionary<string,object>{{"action","sign"},{"privatePath",pem},{"machine",new string('a',64)},{"extra","中文备注 <客户>"},{"output",Path.Combine(dir,"license.key")}});
                    if(!File.Exists(Path.Combine(dir,"license.key")))throw new Exception("授权文件未生成");
                    using(var form=new GeneratorForm()) { form.CreateControl(); }
                    return 0;
                } finally { if(Directory.Exists(dir))Directory.Delete(dir,true); }
            }
            Application.Run(new GeneratorForm()); return 0;
        } catch(Exception ex) { if(args.Length>0) { File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"self-test-error.txt"),ex.ToString()); return 1; } MessageBox.Show(ex.Message,"LA-ERP 授权生成器",MessageBoxButtons.OK,MessageBoxIcon.Error); return 1; }
    }
}
