import fitz


def extract_text_from_pdf(file_path: str) -> list[dict]:
    pages = []

    with fitz.open(file_path) as document:
        for page_number, page in enumerate(document, start=1):
            text = page.get_text("text").strip()

            pages.append({
                "page_number": page_number,
                "text": text
            })

    return pages