from pydantic import BaseModel


class DocumentCreate(BaseModel):
    user_id: int
    filename: str
    file_path: str