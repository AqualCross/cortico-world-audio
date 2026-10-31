# Changelog

## 0.1.0

- 从 `cortico-world-voice` 分出的跨平台版本，包名 `@aqualcross/cortico-world-audio`。
- 按应用监听：Windows / Linux 提供系统声音、麦克风与按应用三路；macOS 只有麦克风，界面隐藏不可用来源。
- 「说话」默认引擎为 Edge 朗读（免密钥、免安装，需要联网），默认音色 `zh-CN-XiaoyiNeural`；合成结果是 mp3，附件类型与文件名跟随实际格式。
- 跨平台适配：`loopback-capture` 改为可选依赖，macOS 不再因它安装失败；系统声音在 Windows 走 WASAPI、Linux 走 PipeWire，macOS 只提供麦克风；播放兜底按平台（Windows PowerShell、macOS afplay、Linux ffplay）；结束进程按平台；ffmpeg 与 uv 三个平台都可在依赖页点击下载（Windows/Linux 用 BtbN，macOS 用 evermeet / osxexperts）；GPT-SoVITS 模型链接改用 symlink；桌面字幕仅 Windows；macOS 不显示系统声音与按应用来源；POSIX 卸载会先清掉占用目录的残留进程。
- uv/ffmpeg 不再猜安装目录：uv 只认配置与 PATH 裸名，ffmpeg 从 PATH 解析真实路径并写回配置。
- 移除 audio_listen 工具：监听只能从「听」页开启，避免模型主动开启监听被市场标记为读取隐私。
- 本地 GPT-SoVITS / RVC / DiffSinger 只在 Windows 上验证过；macOS 与 Linux 为尽力支持。
