import unittest
from unittest.mock import patch

from local_web import normalize_search_results, validate_public_url


class LocalWebSafetyTests(unittest.TestCase):
    def test_rejects_non_http_and_private_urls(self):
        for url in ("file:///etc/passwd", "http://localhost/a", "http://127.0.0.1/a", "ftp://example.com"):
            with self.assertRaises(ValueError):
                validate_public_url(url)

    @patch("local_web.socket.getaddrinfo", side_effect=lambda host, *args, **kwargs: [(2, 1, 6, "", (("127.0.0.1" if host == "127.0.0.1" else "93.184.216.34"), 0))])
    def test_normalizes_and_deduplicates_results(self, _dns):
        payload = {"results": [
            {"title": "A", "url": "https://example.com/item/", "content": "one", "engine": "x"},
            {"title": "duplicate", "url": "https://example.com/item/#tracking", "content": "two"},
            {"title": "B", "url": "http://127.0.0.1/private", "content": "no"},
        ]}
        result = normalize_search_results(payload, limit=5)
        self.assertEqual([item["title"] for item in result], ["A"])
        self.assertEqual(result[0]["rank"], 1)

    @patch("local_web.socket.getaddrinfo", return_value=[(2, 1, 6, "", ("93.184.216.34", 0))])
    def test_domain_filter(self, _dns):
        result = normalize_search_results({"results": [
            {"url": "https://example.com/a"}, {"url": "https://other.test/b"}
        ]}, domains=["example.com"])
        self.assertEqual(len(result), 1)


if __name__ == "__main__":
    unittest.main()
