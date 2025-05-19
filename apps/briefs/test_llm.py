import os
import sys
import time
import json
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Define a flag to check if all packages are available
missing_packages = []
try:
    from dotenv import load_dotenv
except ImportError:
    missing_packages.append("python-dotenv")
    # Define fallback if package is missing
    def load_dotenv():
        print("Warning: dotenv package not available, environment variables may not be loaded")
        return None

try:
    import backoff
except ImportError:
    missing_packages.append("backoff")
    # Create a dummy decorator that just returns the function
    def backoff_dummy(func):
        return func
    backoff = type('', (), {})
    backoff.on_exception = lambda *args, **kwargs: lambda func: func

try:
    from ratelimit import limits, sleep_and_retry
except ImportError:
    missing_packages.append("ratelimit")
    # Create dummy decorators
    def limits(*args, **kwargs):
        return lambda func: func
    def sleep_and_retry(func):
        return func

try:
    from pprint import pprint
except ImportError:
    # Simple fallback if pprint is missing
    def pprint(obj):
        print(obj)

# Define constants
ONE_MINUTE = 60

@sleep_and_retry
@limits(calls=4, period=ONE_MINUTE)  # Adjust calls/period as needed
@backoff.on_exception(backoff.expo if hasattr(backoff, 'expo') else (lambda *args, **kwargs: lambda func: func), 
                     Exception, max_tries=5, 
                     giveup=lambda e: hasattr(e, 'code') and e.code != 429)
def call_llm_with_retry_decorated(model, messages, temperature):
    try:
        content, usage = call_llm(model, messages, temperature)
        return content, usage
    except Exception as e:
        if hasattr(e, 'code') and e.code == 429:
            logger.info("Rate limit exceeded. Retrying...")
            raise  # Re-raise to trigger backoff
        else:
            print(f"API call failed with error: {e}")
            return None, None
# Define mock function for call_llm if import fails
def call_llm(model, messages, temperature):
    """Mock implementation if the real one can't be imported"""
    print(f"Mock call_llm function used with model={model}, messages={messages}, temperature={temperature}")
    return "Mock response", {"tokens": 0}

# Try to import the real implementation
try:
    # Fix the import path to point to the correct location
    from src.llm import call_llm  # Import from src.llm instead of just llm
    print("Successfully imported call_llm function")
except ImportError:
    print("Could not import call_llm, using mock implementation")
    pass  # We'll use the mock function defined above
# The call_llm_with_retry function we'll use
@sleep_and_retry
@limits(calls=4, period=ONE_MINUTE)
@backoff.on_exception(backoff.expo,
                     Exception,
                     max_tries=5,
                     giveup=lambda e: not (
                         str(e).find("429") >= 0 or
                         str(e).find("RESOURCE_EXHAUSTED") >= 0
                     ))
def call_llm_with_retry(model, messages, temperature):
    try:
        content, usage = call_llm(model, messages, temperature)
        return content, usage
    except Exception as e:
        if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
            logger.info("Rate limit exceeded. Retrying... Error: {e}")
            raise  # Re-raise to trigger backoff
        else:
            print(f"API call failed with error: {e}")
            return None, None



def save_llm_log_to_json(filename, log_data):
    """Saves LLM logs to a JSON file."""
    try:
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(log_data, f, indent=4, ensure_ascii=False)
    except Exception as e:
        print(f"Error saving log to JSON: {e}")


def run_llm_tests():
    # Define your tests array here
    tests = [
        # Add your test cases here
        # Example:
        {
            "name": "Test 1",
            "model": "gemini-2.5-flash-preview-04-17",
            "messages": [{"role": "user", "content": "Hello"}],
            "temperature": 0.7
        }
    ]

    results = []
    log_data = []  # Initialize for logging
    
    for test in tests:
        try:
            # Log the details of each call:
            start_time = time.time()
            content, usage = call_llm_with_retry(  # Use the retry-enabled function
                test["model"], test["messages"], test["temperature"]
            )
            elapsed_time = time.time() - start_time

            result = {
                "test_name": test["name"],
                "success": content is not None,
                "elapsed_time": elapsed_time,
                "error": None if content else "API call failed"
            }
            results.append(result)

            log_entry = {
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "test_name": test['name'],
                "model": test['model'],
                "messages": test['messages'],
                "temperature": test['temperature'],
                "response": content,
                "usage": usage,
                "elapsed_time": elapsed_time,
            }
            log_data.append(log_entry)
        except Exception as e:
            print(f"Test execution error: {e}")
            results.append({
                "test_name": test["name"],
                "success": False,
                "error": str(e)
            })

            log_entry = {
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "test_name": test['name'],
                "model": test['model'],
                "messages": test['messages'],
                "temperature": test['temperature'],
                "response": None,
                "usage": None,
                "elapsed_time": time.time() - start_time,
                "error": str(e)
            }
            log_data.append(log_entry)
            
    return results, log_data

if __name__ == "__main__":
    # Run the tests
    results, log_data = run_llm_tests()
    
    # Save logs after all tests
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    save_llm_log_to_json(f"llm_test_log_{timestamp}.json", log_data)
    
    # Print summary
    print("LLM Test Results:")
    for result in results:
        status = "✅" if result["success"] else "❌"
        print(f"{status} {result['test_name']}")