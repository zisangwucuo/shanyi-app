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
