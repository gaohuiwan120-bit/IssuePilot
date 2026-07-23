# IssuePilot Node fixture image — minimal, non-root, no secrets.
# Base pinned to a locally available official slim tag when Hub is unreachable.
FROM node:24-bookworm-slim

# Prefer existing uid/gid 1000 (node image often ships user `node`); otherwise create.
USER root
RUN if getent passwd 1000 >/dev/null; then \
      echo "using existing uid 1000"; \
    else \
      groupadd -g 1000 issuepilot && useradd -m -u 1000 -g 1000 issuepilot; \
    fi \
  && mkdir -p /workspace /tmp \
  && chown -R 1000:1000 /workspace

USER 1000:1000
WORKDIR /workspace

CMD ["node", "-e", "console.log('issuepilot-node ready')"]
