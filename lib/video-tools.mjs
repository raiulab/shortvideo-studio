import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function extractLastFrameDataUrl(inputPath) {
  const { stdout } = await run("ffmpeg", [
    "-v", "error",
    "-sseof", "-0.08",
    "-i", inputPath,
    "-frames:v", "1",
    "-f", "image2pipe",
    "-vcodec", "png",
    "pipe:1"
  ], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
  if (!stdout?.length) throw new Error("元動画の最終フレームを取得できませんでした。");
  return `data:image/png;base64,${stdout.toString("base64")}`;
}

export async function concatenateVideos(firstPath, secondPath, outputPath) {
  return concatenateVideoFiles([firstPath, secondPath], outputPath);
}

export async function concatenateVideoFiles(inputPaths, outputPath) {
  if (!Array.isArray(inputPaths) || inputPaths.length < 2) {
    throw new Error("結合する動画は2本以上必要です。");
  }
  const { width, height } = await probeVideo(inputPaths[0]);
  const fit = `fps=30,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS`;
  const info = await Promise.all(inputPaths.map(async path => ({
    ...(await probeVideo(path)),
    hasAudio: await hasAudioStream(path)
  })));
  const videoFilters = info.map((_, index) => `[${index}:v:0]${fit}[v${index}]`);
  const audioFilters = info.map((item, index) => item.hasAudio
    ? `[${index}:a:0]aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS[a${index}]`
    : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${item.duration},asetpts=PTS-STARTPTS[a${index}]`);
  const concatInputs = info.flatMap((_, index) => [`[v${index}]`, `[a${index}]`]).join("");
  const filter = `${videoFilters.join(";")};${audioFilters.join(";")};${concatInputs}concat=n=${info.length}:v=1:a=1[v][a]`;
  const args = ["-y", "-v", "error"];
  for (const inputPath of inputPaths) args.push("-i", inputPath);
  args.push("-filter_complex", filter, "-map", "[v]", "-map", "[a]");
  args.push(
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart"
  );
  args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  args.push(outputPath);
  await run("ffmpeg", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
}

async function probeVideo(inputPath) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,duration",
    "-of", "json",
    inputPath
  ]);
  const stream = JSON.parse(stdout).streams?.[0];
  if (!stream?.width || !stream?.height) throw new Error("元動画の解像度を取得できませんでした。");
  return { width: Number(stream.width), height: Number(stream.height), duration: Number(stream.duration) || 0 };
}

async function hasAudioStream(inputPath) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "a:0",
    "-show_entries", "stream=index",
    "-of", "csv=p=0",
    inputPath
  ]);
  return Boolean(String(stdout || "").trim());
}

async function run(command, args, options = {}) {
  try {
    return await execFileAsync(command, args, options);
  } catch (error) {
    const details = Buffer.isBuffer(error.stderr) ? error.stderr.toString("utf8") : String(error.stderr || "");
    const wrapped = new Error(details.trim() || `${command}の動画処理に失敗しました。`);
    wrapped.cause = error;
    throw wrapped;
  }
}
