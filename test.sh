#!/bin/zsh

function block {
  echo $1
  curl --request GET \
       --url "https://api.taostats.io/api/call/v1?network=finney&block_number=${1}&full_name=Ethereum.transact" \
       --header 'Authorization: tao-d2a8afe6-1caf-4296-ba4f-2638ca9c5cdf:4d9576ce' \
       --header 'accept: application/json'
}

echo $(block 6759855)


  curl --request GET \
       --url "https://api.taostats.io/api/call/v1?network=finney&block_number=6759855&full_name=Ethereum.transact" \
       --header 'Authorization: tao-d2a8afe6-1caf-4296-ba4f-2638ca9c5cdf:4d9576ce' \
       --header 'accept: application/json'
