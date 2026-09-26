import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return { name: 'JAMI FOOD', short_name: 'JAMI', description: 'Votre restaurant ULC, dans votre poche.', start_url: '/', display: 'standalone', background_color: '#fbf7f0', theme_color: '#641e35', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }] };
}
