FROM ubuntu:22.04

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    gnupg \
    software-properties-common \
    && rm -rf /var/lib/apt/lists/*

# Install Bitcoin Core
RUN add-apt-repository ppa:bitcoin/bitcoin \
    && apt-get update \
    && apt-get install -y bitcoind bitcoin-cli \
    && rm -rf /var/lib/apt/lists/*

# Create bitcoin user
RUN useradd -r -s /bin/false bitcoin \
    && mkdir -p /home/bitcoin/.bitcoin \
    && chown -R bitcoin:bitcoin /home/bitcoin

# Copy Bitcoin configuration
COPY bitcoin.conf /home/bitcoin/.bitcoin/bitcoin.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose Bitcoin regtest ports
EXPOSE 18443 18444

# Set user and entrypoint
USER bitcoin
WORKDIR /home/bitcoin
ENTRYPOINT ["/entrypoint.sh"]
CMD ["bitcoind", "-regtest", "-daemon=0"]