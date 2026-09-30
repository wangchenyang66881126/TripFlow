"""日志：仅输出级别/消息，不记录密钥与完整用户文档。"""
import logging
import sys


class MapAccessFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # 百度 SDK 会在服务查询里带临时签名；访问日志只记录资源路径。
        if isinstance(record.args, tuple) and len(record.args) == 5:
            args = list(record.args)
            if isinstance(args[2], str) and args[2].startswith("/api/v1/baidu-map/"):
                args[2] = args[2].split("?", 1)[0]
                record.args = tuple(args)
        return True


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stdout,
    )
    # 防止第三方 HTTP 库把含 AK/Key 的完整 URL 或头打进日志
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").addFilter(MapAccessFilter())


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
