import { EpisodeReplay } from '@/components/research/episode-replay';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; return <EpisodeReplay id={id} />;
}
