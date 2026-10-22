import logging
import os

from tencentcloud.common.credential import Credential
from tencentcloud.common.profile.client_profile import ClientProfile
from tencentcloud.common.profile.http_profile import HttpProfile
from tencentcloud.common.retry import NoopRetryer
from tencentcloud.sms.v20210111 import models, sms_client

# SDK debug logging includes signed requests and SMS bodies.
logging.getLogger("tencentcloud.common.abstract_client").disabled = True
logging.getLogger("tencentcloud.common.http.request").disabled = True
logger = logging.getLogger("shanyi.sms")


def settings():
    names = ("SECRET_ID", "SECRET_KEY", "SDK_APP_ID", "TEMPLATE_ID", "SIGN_NAME", "REGION", "TEMPLATE_PARAMS")
    values = {name: os.getenv("TENCENT_SMS_" + name, "").strip() for name in names}
    if not all(values.values()):
        return None
    if not values["SDK_APP_ID"].isascii() or not values["SDK_APP_ID"].isdigit() or not values["TEMPLATE_ID"].isascii() or not values["TEMPLATE_ID"].isdigit():
        return None
    params = [part.strip() for part in values["TEMPLATE_PARAMS"].split(",")]
    if params not in (["code"], ["code", "minutes"], ["minutes", "code"]):
        return None
    secret = os.getenv("SHANYI_OTP_SECRET", "")
    if len(secret.encode()) < 32:
        return None
    values["TEMPLATE_PARAMS"] = ",".join(params)
    return values


def send_code(phone, code, config):
    profile = ClientProfile(
        signMethod="TC3-HMAC-SHA256",
        httpProfile=HttpProfile(protocol="https", endpoint="sms.tencentcloudapi.com", reqTimeout=10),
        retryer=NoopRetryer(), disable_region_breaker=True,
    )
    client = sms_client.SmsClient(Credential(config["SECRET_ID"], config["SECRET_KEY"]), config["REGION"], profile)
    request = models.SendSmsRequest()
    request.PhoneNumberSet = ["+86" + phone]
    request.SmsSdkAppId = config["SDK_APP_ID"]
    request.TemplateId = config["TEMPLATE_ID"]
    request.SignName = config["SIGN_NAME"]
    params = {"code": code, "minutes": "5"}
    request.TemplateParamSet = [params[key] for key in config["TEMPLATE_PARAMS"].split(",")]
    response = client.SendSms(request)
    statuses = response.SendStatusSet or []
    sent = len(statuses) == 1 and statuses[0].Code == "Ok" and statuses[0].PhoneNumber == "+86" + phone
    if not sent:
        # 只记录服务商错误码，不记录验证码与密钥。
        detail = statuses[0] if statuses else None
        logger.warning("腾讯云短信发送失败 code=%s", getattr(detail, "Code", None))
    return sent
