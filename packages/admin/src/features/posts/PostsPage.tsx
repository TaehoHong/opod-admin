import {
  Badge,
  Button,
  Group,
  Select,
  Table,
  UnstyledButton,
} from "@mantine/core";
import { useState } from "react";
import { useCursorList } from "../../shared/api/useCursorList";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { TableText } from "../../shared/ui/TableText";
import { PostCreateModal } from "./PostCreateModal";
import { PostDetailModal } from "./PostDetailModal";
import {
  PostInteractionModal,
  type PostInteraction,
} from "./PostInteractionModal";
import { fetchPosts } from "./api";

const CONTENT_TYPES = [
  { value: "", label: "전체" },
  { value: "feed", label: "피드" },
  { value: "reel", label: "릴" },
  { value: "story", label: "스토리" },
];

export function PostsPage() {
  const [contentType, setContentType] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [interaction, setInteraction] = useState<PostInteraction | null>(null);
  const posts = useCursorList(["posts", contentType], (cursor) =>
    fetchPosts({ ...(contentType ? { contentType } : {}), cursor }),
  );

  return (
    <>
      <DataPage
        title="게시글"
        isPending={posts.isPending}
        error={posts.error}
        isEmpty={posts.items.length === 0}
        actions={
          <Group gap="xs">
            <Select
              aria-label="콘텐츠 형식"
              data={CONTENT_TYPES}
              value={contentType}
              onChange={(value) => setContentType(value ?? "")}
              allowDeselect={false}
              w={140}
            />
            <Button onClick={() => setCreateOpen(true)}>게시글 작성</Button>
          </Group>
        }
      >
        <Table.ScrollContainer minWidth={860}>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>내용</Table.Th>
                <Table.Th>형식</Table.Th>
                <Table.Th>해시태그</Table.Th>
                <Table.Th>댓글</Table.Th>
                <Table.Th>반응</Table.Th>
                <Table.Th>작성일</Table.Th>
                <Table.Th>작업</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {posts.items.map((post) => (
                <Table.Tr key={post.id}>
                  <Table.Td maw={360}>
                    <UnstyledButton
                      w="100%"
                      onClick={() => setSelectedPostId(post.id)}
                    >
                      <TableText>{post.content}</TableText>
                    </UnstyledButton>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="light">{post.contentType}</Badge>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {post.hashtags.slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="outline" color="ink">
                          {tag}
                        </Badge>
                      ))}
                    </Group>
                  </Table.Td>
                  <Table.Td>{post.commentCount}</Table.Td>
                  <Table.Td>{post.reactionCount}</Table.Td>
                  <Table.Td>{post.createdAt.slice(0, 10)}</Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Button
                        size="xs"
                        variant="default"
                        onClick={() =>
                          setInteraction({ postId: post.id, mode: "comment" })
                        }
                      >
                        댓글
                      </Button>
                      <Button
                        size="xs"
                        variant="default"
                        onClick={() =>
                          setInteraction({ postId: post.id, mode: "reaction" })
                        }
                      >
                        반응
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <LoadMore
          hasNextPage={posts.hasNextPage}
          isFetching={posts.isFetchingNextPage}
          onLoadMore={() => void posts.fetchNextPage()}
        />
      </DataPage>
      <PostCreateModal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <PostInteractionModal
        interaction={interaction}
        onClose={() => setInteraction(null)}
      />
      {selectedPostId ? (
        <PostDetailModal
          postId={selectedPostId}
          onClose={() => setSelectedPostId(null)}
          onComment={() =>
            setInteraction({ postId: selectedPostId, mode: "comment" })
          }
          onReaction={() =>
            setInteraction({ postId: selectedPostId, mode: "reaction" })
          }
        />
      ) : null}
    </>
  );
}
