# 善衣 SHANYI

善衣的真实 APP 工程起点：Android 客户端 + FastAPI 服务端。

## 项目结构

- `mobile/`：Expo + React Native Android 客户端
- `backend/`：FastAPI API 服务

## 本地启动

### 客户端

```powershell
cd mobile
npm start
```

随后使用 Expo Go 或 Android 模拟器打开项目。

### 服务端

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

开发验证码固定为 `123456`，仅用于本地联调，不能用于生产环境。

## AI 服务器与密钥配置

在 `backend/.env` 填写以下变量（已提供空配置，模板是 `backend/.env.example`）。密钥只能放后端；`.gitignore` 已排除 `.env`，仅提交模板。后端 `app/main.py` 固定读取 `backend/.env`，不依赖启动目录，已有进程环境变量优先；修改后重启后端。

| 功能 | 地址 | 密钥 | 模型 |
| --- | --- | --- | --- |
| 图片可见衣物识别 | `SHANYI_VISION_BASE_URL` | `SHANYI_VISION_API_KEY` | `SHANYI_VISION_MODEL` |
| 候选约束 AI 补齐 | `SHANYI_STYLIST_BASE_URL` | `SHANYI_STYLIST_API_KEY` | `SHANYI_STYLIST_MODEL` |
| 人物照片试穿生成 | `SHANYI_TRYON_BASE_URL` | `SHANYI_TRYON_API_KEY` | `SHANYI_TRYON_MODEL` |

- 视觉与补齐需要兼容 OpenAI `POST /chat/completions`、Bearer 鉴权和 `response_format: json_object`，返回 `choices[0].message.content` JSON 字符串。视觉模型还必须支持 `image_url` 的 base64 data URL。补齐使用文本模型，从当前账户衣橱和目录候选中选择，服务端验证候选 ID 与类别，不接受虚构商品。
- 试穿需要兼容 `POST /images/edits` 的**多图片编辑**模型：multipart 重复 `image[]` 字段，第一张是人物照，后续是目录套装参考图；支持 `model`、`prompt`、`n=1`、`output_format=jpeg`，返回 `data[0].b64_json` 或 `data[0].url`。base64 结果继续验证格式、大小、分辨率及完整解码；URL 结果仅接受无账户信息、默认或 443 端口的 HTTPS 地址，拒绝 localhost、非公网 IP 字面量及非法主机格式。后端不解析 DNS、不抓取结果 URL；客户端直接加载且不附加 API Authorization，因此不会因结果 URL 引入服务端任意抓取或 DNS 重绑定。URL 的实际可读性、内容和有效期取决于服务商，客户端加载失败会明确提示；“仅重新加载图片”不会再次调用生成或产生生成费用。能看图的聊天模型不代表能生成或编辑图片，三组模型可来自不同服务商。
- Base URL 填服务商 API 根路径，如 `https://api.example.com/v1`；若供应商要求 `/v1`，必须自己包含，代码不会自动加版本号。代码分别追加 `/chat/completions` 或 `/images/edits`，也允许填写对应完整端点。试穿只接受 HTTPS 默认 443 端口、不带账户信息、query 或 fragment 的地址。云端视觉和补齐也应使用 HTTPS；HTTP 仅用于可信本地兼容服务。
- 三项配置齐全仅表示“已配置”，不表示模型能力、余额或连通性已经验证。没有配置时视觉和试穿返回 503；补齐明确返回 `source=rules` 及规则说明。已配置但请求失败时返回错误，不把规则或目录图片冒充模型结果。
- 推荐页继续使用目录与衣橱匹配规则，不调用模型生成整库。试穿图片临时返回客户端，不写入衣橱或服务器文件；外部服务商的数据保留与费用按其政策。参考图片下载仅允许现有目录图片来源。

后端可直接运行在这台电脑，无需 GPU 或购买 GPU 云服务器；电脑需能访问所选云端 API 及目录图片服务。手机与电脑在同一局域网时运行：

```powershell
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

将 `mobile/.env.example` 复制为 `mobile/.env`，把 `EXPO_PUBLIC_API_URL` 改成 `http://电脑局域网IP:8000`（Android 模拟器一般为 `http://10.0.2.2:8000`；同机浏览器为 `http://127.0.0.1:8000`），并允许防火墙的开发端口访问。这个变量**只指向善衣后端，不是模型服务器，不放任何 API 密钥**，末尾不加 `/api`。修改后重新启动 Expo。当前固定验证码仅适合本地开发，不应直接将这套登录服务暴露到公网。

首页按天气场合 → 自拍识别 → 确认衣物 → 补齐建议使用；套装详情进入 AI 试穿，选择本人照片、同意发送到外部 AI 后生成。上传支持完整 JPG/PNG/WEBP、最大 5MB，试穿还限制边长 8192 与总像素 3200 万。后端生成总等待上限 210 秒，客户端 240 秒；超时或离开页面后重试可能重复产生供应商费用。

## 校验

```powershell
cd backend
python -m unittest discover -v
cd ../mobile
npx tsc --noEmit
npm run lint
```

AI 测试通过 mock 覆盖接口行为，不需要真实密钥。实际服务商兼容性、模型效果与费用需填写你自己的配置后验证；工程测试不能代替真实模型验证。
