from datetime import datetime, timezone


def utcnow() -> datetime:
    """Current UTC time as a naive datetime.

    The database columns are `timestamp without time zone` holding UTC values,
    so we strip the tzinfo to match. This replaces `datetime.utcnow`, which is
    deprecated from Python 3.12 onwards.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)
