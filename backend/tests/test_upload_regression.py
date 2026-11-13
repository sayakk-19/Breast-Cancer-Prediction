"""Model/upload regression checks without a database or network connection."""
import unittest
from pathlib import Path
import pandas as pd
from fastapi import HTTPException
from backend.app.dataset_tools import read_dataset, analyze, explain
from backend.app.inference import ModelBundle, EXPORT_DIRECTORY

class MemoryUpload:
    filename = 'test.csv'
    def __init__(self, raw): self.raw = raw
    async def read(self, limit): return self.raw[:limit]

def parse(frame):
    operation = read_dataset(MemoryUpload(frame.to_csv(index=False).encode()))
    try:
        operation.send(None)
    except StopIteration as result:
        return result.value
    finally:
        operation.close()

class UploadRegression(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = pd.read_csv(EXPORT_DIRECTORY.parent / 'breast_cancer_data.csv')
        cls.bundle = ModelBundle(EXPORT_DIRECTORY)

    def test_limit(self):
        large = pd.concat([self.raw] * 4, ignore_index=True)
        self.assertEqual(len(parse(large.head(2000))[0]), 2000)
        with self.assertRaises(HTTPException) as error: parse(large.head(2001))
        self.assertEqual(error.exception.status_code, 422)

    def test_nonfinite(self):
        frame = self.raw.head(2).copy()
        frame.loc[0, 'radius_mean'] = float('inf')
        with self.assertRaises(HTTPException): parse(frame)

    def test_models_and_shap(self):
        from threadpoolctl import threadpool_limits
        frame, _, labels = parse(self.raw.head(10))
        with threadpool_limits(limits=1):
            results = analyze(self.bundle, frame, labels)
            self.assertEqual(len(results), 10)
            self.assertTrue(all(0 <= item['mean_probability'] <= 1 for item in results))
            contributions = explain(self.bundle, frame)
        self.assertEqual(len(contributions), 30)
        self.assertAlmostEqual(sum(item['value'] for item in contributions), 1)

if __name__ == '__main__': unittest.main()
