#!/bin/bash
#
# ralph-loop.sh - Autonomous AI Agent Loop for Claude Code
# Based on https://github.com/snarktank/ralph
#
# Runs Claude Code repeatedly until all PRD user stories are complete.
# Each iteration is a fresh context with memory persisted via:
# - git commit history
# - progress.txt (append-only learnings)
# - prd.json (task status)
#

set -e

# Configuration
MAX_ITERATIONS=${1:-10}
PROMPT_FILE="scripts/prompt.md"
PRD_FILE="prd.json"
PROGRESS_FILE="progress.txt"
ARCHIVE_DIR="archive"
BRANCH_TRACKER=".last-branch"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Ralph Loop - Autonomous Agent Loop   ${NC}"
echo -e "${BLUE}  Max Iterations: ${MAX_ITERATIONS}              ${NC}"
echo -e "${BLUE}========================================${NC}"

# Check prerequisites
check_prerequisites() {
    if ! command -v claude &> /dev/null; then
        echo -e "${RED}Error: Claude Code CLI not found. Install it first.${NC}"
        exit 1
    fi

    if ! command -v jq &> /dev/null; then
        echo -e "${RED}Error: jq not found. Install it with: brew install jq${NC}"
        exit 1
    fi

    if [ ! -f "$PRD_FILE" ]; then
        echo -e "${RED}Error: $PRD_FILE not found. Create it first with /ralph skill.${NC}"
        exit 1
    fi

    if [ ! -f "$PROMPT_FILE" ]; then
        echo -e "${RED}Error: $PROMPT_FILE not found. Copy it from the skill.${NC}"
        exit 1
    fi

    if ! git rev-parse --is-inside-work-tree &> /dev/null; then
        echo -e "${RED}Error: Not inside a git repository.${NC}"
        exit 1
    fi
}

# Archive previous run if branch changed
archive_if_branch_changed() {
    local current_branch=$(jq -r '.branchName // empty' "$PRD_FILE")

    if [ -z "$current_branch" ]; then
        return
    fi

    if [ -f "$BRANCH_TRACKER" ]; then
        local last_branch=$(cat "$BRANCH_TRACKER")
        if [ "$last_branch" != "$current_branch" ] && [ -n "$last_branch" ]; then
            local archive_name="${last_branch#ralph/}"
            local timestamp=$(date +%Y-%m-%d)
            local archive_path="$ARCHIVE_DIR/$timestamp-$archive_name"

            echo -e "${YELLOW}Branch changed from $last_branch to $current_branch${NC}"
            echo -e "${YELLOW}Archiving previous run to $archive_path${NC}"

            mkdir -p "$archive_path"
            [ -f "$PRD_FILE" ] && cp "$PRD_FILE" "$archive_path/" 2>/dev/null || true
            [ -f "$PROGRESS_FILE" ] && cp "$PROGRESS_FILE" "$archive_path/" 2>/dev/null || true

            # Reset progress for new branch
            rm -f "$PROGRESS_FILE"
        fi
    fi

    echo "$current_branch" > "$BRANCH_TRACKER"
}

# Initialize progress file if needed
init_progress() {
    if [ ! -f "$PROGRESS_FILE" ]; then
        echo "# Progress Log" > "$PROGRESS_FILE"
        echo "" >> "$PROGRESS_FILE"
        echo "Started: $(date)" >> "$PROGRESS_FILE"
        echo "Project: $(jq -r '.project // "Unknown"' "$PRD_FILE")" >> "$PROGRESS_FILE"
        echo "Goal: $(jq -r '.goal // "Unknown"' "$PRD_FILE")" >> "$PROGRESS_FILE"
        echo "" >> "$PROGRESS_FILE"
        echo "---" >> "$PROGRESS_FILE"
        echo "" >> "$PROGRESS_FILE"
    fi
}

# Check if all stories are complete
all_stories_complete() {
    local incomplete=$(jq '[.userStories[] | select(.passes == false)] | length' "$PRD_FILE")
    [ "$incomplete" -eq 0 ]
}

# Get status summary
get_status() {
    local total=$(jq '.userStories | length' "$PRD_FILE")
    local complete=$(jq '[.userStories[] | select(.passes == true)] | length' "$PRD_FILE")
    echo "$complete/$total"
}

# Run a single iteration
run_iteration() {
    local iteration=$1
    local status=$(get_status)

    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  Iteration $iteration of $MAX_ITERATIONS${NC}"
    echo -e "${GREEN}  Stories Complete: $status${NC}"
    echo -e "${GREEN}  $(date)${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""

    # Read the prompt file
    local prompt=$(cat "$PROMPT_FILE")

    # Run Claude Code with the prompt
    # --dangerously-skip-permissions allows autonomous operation
    # --print outputs to stdout for capture
    local output
    output=$(claude --dangerously-skip-permissions --print "$prompt" 2>&1) || true

    echo "$output"

    # Check for completion signal
    if echo "$output" | grep -q "<promise>COMPLETE</promise>"; then
        echo ""
        echo -e "${GREEN}========================================${NC}"
        echo -e "${GREEN}  ALL STORIES COMPLETE!${NC}"
        echo -e "${GREEN}========================================${NC}"
        return 0
    fi

    return 1
}

# Main loop
main() {
    check_prerequisites
    archive_if_branch_changed
    init_progress

    # Check if already complete
    if all_stories_complete; then
        echo -e "${GREEN}All stories already complete!${NC}"
        exit 0
    fi

    local iteration=1
    while [ $iteration -le $MAX_ITERATIONS ]; do
        if run_iteration $iteration; then
            echo -e "${GREEN}Ralph Loop completed successfully!${NC}"
            exit 0
        fi

        # Check if all complete after iteration
        if all_stories_complete; then
            echo -e "${GREEN}All stories complete after iteration $iteration!${NC}"
            exit 0
        fi

        iteration=$((iteration + 1))

        # Brief pause between iterations
        if [ $iteration -le $MAX_ITERATIONS ]; then
            echo -e "${YELLOW}Pausing 2 seconds before next iteration...${NC}"
            sleep 2
        fi
    done

    echo ""
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}  Max iterations ($MAX_ITERATIONS) reached${NC}"
    echo -e "${RED}  Stories: $(get_status) complete${NC}"
    echo -e "${RED}========================================${NC}"
    exit 1
}

main
