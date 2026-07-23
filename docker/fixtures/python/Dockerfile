# IssuePilot Python fixture image — minimal, non-root, no secrets / no PyTorch.
# Base pinned to a locally available official slim tag when Hub is unreachable.
# No pip install at build time (fixtures use plain python scripts; avoids PyPI/network).
FROM python:3.12-slim-bookworm

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
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

CMD ["python", "-c", "print('issuepilot-python ready')"]
