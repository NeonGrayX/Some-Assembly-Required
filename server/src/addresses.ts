import { networkInterfaces } from 'node:os';

export interface Address {
  address: string;
  /** The network adapter's name, as the system calls it. */
  adapter: string;
  /** A private home or office network, rather than a VPN, container or virtual machine. */
  likelyLan: boolean;
}

/** Adapters that virtual machines, containers and VPNs add, which friends cannot reach. */
const VIRTUAL =
  /^(vEthernet|vmnet|VMware|VirtualBox|docker|br-|veth|virbr|lxc|lxd|cni|flannel|tailscale|zt|utun|wg|tun|tap|ham)/i;

const isPrivate = (ip: string) =>
  /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

/** This machine's IPv4 addresses that other computers might reach, likeliest first. */
export function lanAddresses(): Address[] {
  const found: Address[] = [];
  for (const [adapter, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      found.push({
        address: a.address,
        adapter,
        likelyLan: isPrivate(a.address) && !VIRTUAL.test(adapter),
      });
    }
  }
  return found.sort((a, b) => Number(b.likelyLan) - Number(a.likelyLan));
}
