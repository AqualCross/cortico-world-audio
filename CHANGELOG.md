# Changelog

## 0.1.4

- FireRed 监听不再吃满 CPU：VAD 与 AED 的 ONNX 会话改为单线程、顺序执行并关闭空闲自旋。onnxruntime 默认按物理核开线程池、线程空闲时自旋等活，监听有声音时几十个核都在空转（64 线程机器上实测 30.8 核 → 0.04 核），单帧延迟反而略降；AED 60 秒块约 0.4 秒，不受影响。

## 0.1.3

- 说话改为流式：Edge、本机 GPT-SoVITS 与 OpenAI 兼容接口边合成边交给 ffmpeg 解码播放，不再等整句；播放队列在当前句开播时预取下一条，连续说话不再等合成。缺 ffmpeg 或原生输出时自动退回收齐再播；流式 WAV 落盘前补长度，记录能读出准确时长。
- Edge 连接按音色复用，同一音色连说不再每次重连；新建连接约 1 秒的代价只付一次，之后首音约 0.3 秒。
- 说话首块 PCM 到达时写一条「说话首音」日志（`worlds.audio`），带播放等待与合成耗时。

## 0.1.2

- 播放支持左右平衡：新增 `worlds.audio.balance`（-100 全左 … 100 全右，0 居中）和播放页滑杆；`audio_play`、`audio_say` 可按条或按句指定 `balance`。原生 PCM 输出按左右声道衰减；Windows 的 PowerShell 兜底同步支持，Linux 的 ffplay 兜底使用 pan 滤镜；macOS 的 afplay 没有左右调节，退回它时该参数不生效。

## 0.1.1

- 市场卡片不再标「仅 Windows」：去掉继承自声音扩展的 `os` 限制，三个平台的安装不再被标记限制。

## 0.1.0

- 从 `cortico-world-voice` 分出的跨平台版本，包名 `@aqualcross/cortico-world-audio`。
- 按应用监听：Windows / Linux 提供系统声音、麦克风与按应用三路；macOS 只有麦克风，界面隐藏不可用来源。
- 「说话」默认引擎为 Edge 朗读（免密钥、免安装，需要联网），默认音色 `zh-CN-XiaoyiNeural`；合成结果是 mp3，附件类型与文件名跟随实际格式。
- 跨平台适配：`loopback-capture` 改为可选依赖，macOS 不再因它安装失败；系统声音在 Windows 走 WASAPI、Linux 走 PipeWire，macOS 只提供麦克风；播放兜底按平台（Windows PowerShell、macOS afplay、Linux ffplay）；结束进程按平台；ffmpeg 与 uv 三个平台都可在依赖页点击下载（Windows/Linux 用 BtbN，macOS 用 evermeet / osxexperts）；GPT-SoVITS 模型链接改用 symlink；桌面字幕仅 Windows；macOS 不显示系统声音与按应用来源；POSIX 卸载会先清掉占用目录的残留进程。
- uv/ffmpeg 不再猜安装目录：uv 只认配置与 PATH 裸名，ffmpeg 从 PATH 解析真实路径并写回配置。
- 移除 audio_listen 工具：监听只能从「听」页开启，避免模型主动开启监听被市场标记为读取隐私。
- 本地 GPT-SoVITS / RVC / DiffSinger 只在 Windows 上验证过；macOS 与 Linux 为尽力支持。
