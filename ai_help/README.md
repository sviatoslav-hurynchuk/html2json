# AI Usage & Workflow Documentation

This directory contains artifacts documenting the full conversation history, thought process, and workflow used during the development of the `html2json` test task, in compliance with Jito's test task requirements.

## 🛠 AI Tooling Details
- **Platform:** Google Antigravity Agent (Integrated Engineering Environment)
- **Model:** Claude Sonnet 4.6 (Thinking Mode enabled)
- **Role of AI:** Assisted implementation and scaffolding accelerator.
- **Role of Engineer:** Architecture design, AST schema definition, edge-case specification, quality verification, Clean Code standards enforcement, and CI/CD code review workflow.

## 📂 Included Artifacts
1. **`AI Development Transcript - html2json.pdf`** — Formatted PDF export of the full development conversation.
2. **`AI_CONVERSATION_TRANSCRIPT.md`** — Complete textual transcript of the conversation with all prompts, reasoning, and solutions.
3. **`AI_CONVERSATION_TRANSCRIPT.html`** — Clean, human-readable HTML view of the full dialog.
4. **Screenshots (`ai_conversation_s1.png`, `ai_conversation_s2.png`, `ai_conversation_s3.png`)** — Visual proof of prompts, thinking process, and the development session directly in the IDE.

## 🔄 Development Trajectory
1. **Architectural Scaffolding:** Defined AST requirements (5 node types, `type` discriminator, flat attributes, preserved node ordering).
2. **Edge-Case Hardening:** Defined strict criteria for HTML5 void tags, raw-text elements (`<script>`, `<style>`, `<textarea>`), boolean attributes, comments, doctypes, and malformed HTML recovery.
3. **Resilient Implementation:** Built pure JS scanner/tokenizer + tag stack (Zero dependencies, No DOMParser).
4. **Verification & Testing:** Generated 10 test files in `html_samples/` and created an automated test runner with 66 comprehensive assertions covering crash resilience.
5. **Clean Code & Review:** Refactored comments according to "Why, not What" principles and configured CodeRabbit for automated PR reviews.
