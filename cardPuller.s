#!/usr/bin/env bash

# Usage check
if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <deck_list> <card_list>"
  exit 1
fi

DECK="$1"
CARDS="$2"

# Detect delimiter in the cards file: prefer | if it exists on first non-empty line
DELIM=$(awk 'NF { if (index($0,"|")) print "|"; else print ","; exit }' "$CARDS")

if [ "$DELIM" = "|" ]; then
  # Pipe-delimited cards file: simple + fast
  awk -F'|' '
  FNR==NR {
    sub(/^([0-9]+[[:space:]]+)/, "")
    deck[$0]=1
    next
  }
  {
    name=$2
    gsub(/"/,"",name)
    if (deck[name]) print
  }
  ' "$DECK" "$CARDS"
else
  # Comma CSV cards file: handle quoted commas safely
  awk -v FPAT='([^,]+)|(\"[^\"]+\")' '
  FNR==NR {
    sub(/^([0-9]+[[:space:]]+)/, "")
    deck[$0]=1
    next
  }
  {
    name=$2
    gsub(/"/,"",name)
    if (deck[name]) print
  }
  ' "$DECK" "$CARDS"
fi
