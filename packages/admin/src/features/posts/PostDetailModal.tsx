import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { previewUrl } from "../../shared/media/previewUrl";
import { ZoomableImage } from "../../shared/ui/ZoomableImage";
import { fetchCharacters } from "../characters/api";
import {
  fetchPost,
  fetchPostActionLogs,
  fetchPostComments,
  fetchPostReactions,
  type PostComment,
  type PostReaction,
} from "./api";

export function PostDetailModal({
  postId,
  onClose,
  onComment,
  onReaction,
}: {
  postId: string;
  onClose: () => void;
  onComment: () => void;
  onReaction: () => void;
}) {
  const post = useQuery({
    queryKey: ["posts", "detail", postId],
    queryFn: () => fetchPost(postId),
  });
  const comments = useQuery({
    queryKey: ["posts", "comments", postId],
    queryFn: () => fetchPostComments(postId, { limit: "50" }),
  });
  const reactions = useQuery({
    queryKey: ["posts", "reactions", postId],
    queryFn: () => fetchPostReactions(postId, { limit: "50" }),
  });
  const logs = useQuery({
    queryKey: ["posts", "action-logs", postId],
    queryFn: () => fetchPostActionLogs(postId),
  });
  const characters = useQuery({
    queryKey: ["post-character-labels"],
    queryFn: () => fetchCharacters({ limit: "50" }),
    staleTime: 5 * 60 * 1000,
  });
  const characterNames = new Map(
    (characters.data?.items ?? []).map((item) => [
      item.id,
      item.displayName || `@${item.publicId}`,
    ]),
  );

  return (
    <Modal
      opened
      onClose={onClose}
      title={
        post.data
          ? characterLabel(post.data.characterId, characterNames)
          : "게시글 상세"
      }
      size="xl"
    >
      {post.isPending ? (
        <Loader aria-label="게시글 상세 불러오는 중" />
      ) : post.error ? (
        <Alert color="red" role="alert" title="게시글을 불러오지 못했습니다">
          {post.error.message}
        </Alert>
      ) : post.data ? (
        <Stack
          gap="lg"
          style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
        >
          <Group gap="xs">
            <Badge variant="light">{post.data.contentType}</Badge>
            <Text size="sm" c="dimmed">
              {formatDateTime(post.data.createdAt)}
            </Text>
          </Group>
          <Text size="lg">{post.data.content}</Text>
          {post.data.hashtags.length > 0 ? (
            <Group gap="xs">
              {post.data.hashtags.map((tag) => (
                <Badge key={tag} variant="outline">
                  #{tag}
                </Badge>
              ))}
            </Group>
          ) : null}
          <MediaGallery media={post.data.media} />
          <Group gap="xs">
            <Button variant="default" onClick={onComment}>
              캐릭터 댓글 달기
            </Button>
            <Button variant="default" onClick={onReaction}>
              캐릭터 반응 추가
            </Button>
          </Group>
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            <DetailSection
              title="댓글"
              isPending={comments.isPending}
              error={comments.error}
              empty={comments.data?.items.length === 0}
              emptyLabel="댓글이 없습니다."
            >
              {comments.data?.items.map((item) => (
                <InteractionRow
                  key={item.id}
                  actor={actorLabel(item, characterNames)}
                  value={item.body}
                  createdAt={item.createdAt}
                />
              ))}
            </DetailSection>
            <DetailSection
              title="반응"
              isPending={reactions.isPending}
              error={reactions.error}
              empty={reactions.data?.items.length === 0}
              emptyLabel="반응이 없습니다."
            >
              {reactions.data?.items.map((item) => (
                <InteractionRow
                  key={item.id}
                  actor={actorLabel(item, characterNames)}
                  value={item.reactionType}
                  createdAt={item.createdAt}
                />
              ))}
            </DetailSection>
            <DetailSection
              title="관련 액션 로그"
              isPending={logs.isPending}
              error={logs.error}
              empty={logs.data?.items.length === 0}
              emptyLabel="관련 로그가 없습니다."
            >
              {logs.data?.items.map((item) => (
                <InteractionRow
                  key={item.id}
                  actor={characterLabel(item.characterId, characterNames)}
                  value={`${item.actionType} · ${item.reason || "사유 없음"}`}
                  createdAt={item.createdAt}
                />
              ))}
            </DetailSection>
          </SimpleGrid>
        </Stack>
      ) : null}
    </Modal>
  );
}

function MediaGallery({
  media,
}: {
  media: Array<{ mediaType: "image" | "video"; url: string }>;
}) {
  if (media.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        첨부 미디어가 없습니다.
      </Text>
    );
  }
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }}>
      {media.map((item, index) => {
        const source = previewUrl(item.url);
        return (
          <Paper key={`${item.url}-${index}`} p="xs" withBorder>
            {source && item.mediaType === "image" ? (
              <ZoomableImage
                src={source}
                alt={`게시글 미디어 ${index + 1}`}
                h={220}
                fit="contain"
              />
            ) : source && item.mediaType === "video" ? (
              <video
                src={source}
                controls
                preload="metadata"
                aria-label={`게시글 미디어 ${index + 1}`}
                style={{ display: "block", width: "100%", maxHeight: 220 }}
              />
            ) : (
              <Text size="sm" c="dimmed">
                미리보기를 표시할 수 없습니다.
              </Text>
            )}
          </Paper>
        );
      })}
    </SimpleGrid>
  );
}

function DetailSection({
  title,
  isPending,
  error,
  empty,
  emptyLabel,
  children,
}: {
  title: string;
  isPending: boolean;
  error: Error | null;
  empty: boolean;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Stack gap="xs">
      <Title order={5}>{title}</Title>
      {isPending ? (
        <Loader size="sm" aria-label={`${title} 불러오는 중`} />
      ) : error ? (
        <Alert color="red" role="alert">
          {error.message}
        </Alert>
      ) : empty ? (
        <Text size="sm" c="dimmed">
          {emptyLabel}
        </Text>
      ) : (
        children
      )}
    </Stack>
  );
}

function InteractionRow({
  actor,
  value,
  createdAt,
}: {
  actor: string;
  value: string;
  createdAt: string;
}) {
  return (
    <Paper p="xs" withBorder>
      <Text size="xs" c="dimmed">
        {actor} · {formatDateTime(createdAt)}
      </Text>
      <Text size="sm">{value}</Text>
    </Paper>
  );
}

function actorLabel(
  item: Pick<PostComment | PostReaction, "characterId" | "userId">,
  names: Map<string, string>,
) {
  if (item.characterId) return characterLabel(item.characterId, names);
  if (item.userId) return `사용자 ${shortId(item.userId)}`;
  return "알 수 없는 작성자";
}

function characterLabel(id: string, names: Map<string, string>) {
  return names.get(id) ?? `캐릭터 ${shortId(id)}`;
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

function formatDateTime(value: string) {
  return value.replace("T", " ").slice(0, 16);
}
