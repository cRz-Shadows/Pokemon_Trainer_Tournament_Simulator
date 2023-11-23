# -*- coding: utf-8 -*-
"""
Created on Thu Jan  5 18:24:32 2023

@author: craig
"""

import json
import pprint

def capitalize_words(s: str) -> str:
    return ' '.join([word.capitalize() for word in s.split()])

# Open the JSON file
with open('type-chart.json', 'r') as f:
    data = json.load(f)

# Recursively traverse the JSON object and capitalize every string value
def transform(obj):
    if isinstance(obj, str):
        return capitalize_words(obj)
    if isinstance(obj, dict):
        return {k: transform(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [transform(item) for item in obj]
    return obj

formatted_json = pprint.pformat(transform(data))

# Write the formatted JSON string to the file
with open('file.json', 'w') as f:
    f.write(formatted_json)