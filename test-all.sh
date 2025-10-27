#!/bin/bash

# Feedboard Comprehensive Test Script
# Tests all implemented API endpoints

# Configuration
BASE_URL="http://localhost:3000"
SS58_ADDRESS="5EvkUbiUVxb8HPeMvVW5XigyQiwNsNLMLpuAuaUAFvGQEdCQ"
EVM_ADDRESS="0xC7d40db455F5BaEDB4a8348dE69e8527cD94AFD8"
# USDC token contract address on Bittensor EVM chain
USDC_CONTRACT="0xB833E8137FEDf80de7E908dc6fea43a029142F20"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counter for tests
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Function to print test header
print_test() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}TEST: $1${NC}"
    echo -e "${BLUE}========================================${NC}"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
}

# Function to make request and show result
test_endpoint() {
    local url=$1
    local description=$2
    local expected_status=${3:-200}

    print_test "$description"
    echo -e "${YELLOW}URL:${NC} $url"
    echo ""

    # Make request
    response=$(curl -s -w "\n%{http_code}" "$url")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    # Check status code
    if [ "$http_code" -eq "$expected_status" ]; then
        echo -e "${GREEN}✓ Status: $http_code (Expected: $expected_status)${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo -e "${RED}✗ Status: $http_code (Expected: $expected_status)${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
    fi

    # Show response (first 500 characters)
    echo -e "\n${YELLOW}Response:${NC}"
    echo "$body" | head -c 500
    if [ ${#body} -gt 500 ]; then
        echo "... (truncated)"
    fi
    echo ""
}

# Main test suite
echo -e "${GREEN}========================================"
echo -e "Feedboard API Test Suite"
echo -e "========================================${NC}"
echo -e "Base URL: $BASE_URL"
echo -e "SS58 Address: $SS58_ADDRESS"
echo -e "EVM Address: $EVM_ADDRESS"
echo -e "USDC Contract: $USDC_CONTRACT"

# Test 1: Health Check
test_endpoint \
    "$BASE_URL/health" \
    "Health Check"

# Test 2: Root Endpoint (API Info)
test_endpoint \
    "$BASE_URL/" \
    "Root Endpoint - API Information"

# Test 3: Current Price
test_endpoint \
    "$BASE_URL/api/price/current" \
    "Current TAO Price"

# Test 4: Historical Prices
test_endpoint \
    "$BASE_URL/api/price/historical" \
    "Historical TAO Prices"

# Test 5: SS58 Incoming Transfers
test_endpoint \
    "$BASE_URL/api/transfers/ss58/$SS58_ADDRESS/in" \
    "SS58 Incoming Transfers"

# Test 6: SS58 Outgoing Transfers
test_endpoint \
    "$BASE_URL/api/transfers/ss58/$SS58_ADDRESS/out" \
    "SS58 Outgoing Transfers"

# Test 7: EVM Incoming Transfers
test_endpoint \
    "$BASE_URL/api/transfers/evm/$EVM_ADDRESS/in" \
    "EVM Incoming Transfers"

# Test 8: EVM Outgoing Transfers
test_endpoint \
    "$BASE_URL/api/transfers/evm/$EVM_ADDRESS/out" \
    "EVM Outgoing Transfers"

# Test 9: SS58 Balance
test_endpoint \
    "$BASE_URL/api/balance/ss58/$SS58_ADDRESS" \
    "SS58 Account Balance"

# Test 10: EVM Balance
test_endpoint \
    "$BASE_URL/api/balance/evm/$EVM_ADDRESS" \
    "EVM Account Balance"

# Test 11: EVM Token Incoming Transfers (USDC)
test_endpoint \
    "$BASE_URL/api/token-transfers/evm/$USDC_CONTRACT/$EVM_ADDRESS/in" \
    "EVM Token Incoming Transfers (USDC)"

# Test 12: EVM Token Outgoing Transfers (USDC)
test_endpoint \
    "$BASE_URL/api/token-transfers/evm/$USDC_CONTRACT/$EVM_ADDRESS/out" \
    "EVM Token Outgoing Transfers (USDC)"

# Test 13: SS58 Token Transfers (Not Implemented - should return 501)
test_endpoint \
    "$BASE_URL/api/token-transfers/ss58/1/$SS58_ADDRESS/in" \
    "SS58 Token Transfers (Expected: Not Implemented)" \
    501

# Summary
echo -e "\n${BLUE}========================================"
echo -e "Test Summary"
echo -e "========================================${NC}"
echo -e "Total Tests: $TOTAL_TESTS"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "${RED}Failed: $FAILED_TESTS${NC}"

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "\n${GREEN}✓ All tests passed!${NC}"
    exit 0
else
    echo -e "\n${RED}✗ Some tests failed${NC}"
    exit 1
fi
