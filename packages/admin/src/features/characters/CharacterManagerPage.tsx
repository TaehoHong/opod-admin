import { Badge, Button, Group, Paper, Stack, Tabs, Text } from "@mantine/core";
import { UserCircle } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { DataPage } from "../../shared/ui/DataPage";
import { CharacterActivityPanel } from "./CharacterActivityPanel";
import { CharacterAutomationPanel } from "./CharacterAutomationPanel";
import { CharacterMemoriesPanel } from "./CharacterMemoriesPanel";
import { CharacterPersonasPanel } from "./CharacterPersonasPanel";
import { CharacterPostsPanel } from "./CharacterPostsPanel";
import { CharacterProfilePanel } from "./CharacterProfilePanel";
import { CharacterVisualPanel } from "./CharacterVisualPanel";
import { fetchCharacter } from "./api";
import styles from "./CharacterManagerPage.module.css";

export function CharacterManagerPage() {
  const { characterId } = useParams();
  const character = useQuery({
    queryKey: ["character", characterId],
    queryFn: () => fetchCharacter(characterId!),
    enabled: Boolean(characterId),
  });

  if (!characterId) return <Navigate to="/characters" replace />;

  return (
    <DataPage
      title={character.data?.displayName ?? "캐릭터 관리"}
      isPending={character.isPending}
      error={character.error}
      actions={
        <Button component={Link} to="/characters" variant="default">
          목록으로
        </Button>
      }
    >
      {character.data ? (
        <Stack>
          <Paper className={styles.identity} p="lg" component="section">
            <Group align="center" wrap="wrap">
              <span className={styles.identityMark} aria-hidden="true">
                <UserCircle size={30} weight="duotone" />
              </span>
              <Stack gap={3}>
                <Group gap="xs">
                  <Text fw={750}>{character.data.displayName}</Text>
                  <Badge
                    color={character.data.status === "active" ? "teal" : "ink"}
                    variant="light"
                  >
                    {character.data.status === "active" ? "운영 중" : "비활성"}
                  </Badge>
                </Group>
                <Text size="sm" c="dimmed">
                  @{character.data.publicId}
                </Text>
              </Stack>
              <div className={styles.identityStats}>
                <Stack gap={0} className={styles.stat}>
                  <Text size="lg" fw={750}>
                    {character.data.postCount.toLocaleString()}
                  </Text>
                  <Text size="xs" c="dimmed">
                    게시물
                  </Text>
                </Stack>
                <Stack gap={0} className={styles.stat}>
                  <Text size="lg" fw={750}>
                    {character.data.followerCount.toLocaleString()}
                  </Text>
                  <Text size="xs" c="dimmed">
                    팔로워
                  </Text>
                </Stack>
              </div>
            </Group>
          </Paper>
          <Paper className={styles.workspace} p={0} component="section">
            <Tabs defaultValue="profile">
              <Tabs.List className={styles.tabsList}>
                <Tabs.Tab value="profile">프로필</Tabs.Tab>
                <Tabs.Tab value="personas">페르소나</Tabs.Tab>
                <Tabs.Tab value="memory">메모리</Tabs.Tab>
                <Tabs.Tab value="posts">게시글</Tabs.Tab>
                <Tabs.Tab value="activity">활동</Tabs.Tab>
                <Tabs.Tab value="visual">비주얼</Tabs.Tab>
                <Tabs.Tab value="automation">자동화</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="profile" className={styles.panel}>
                <CharacterProfilePanel
                  key={character.data.id}
                  character={character.data}
                />
              </Tabs.Panel>
              <Tabs.Panel value="personas" className={styles.panel}>
                <CharacterPersonasPanel
                  characterId={character.data.id}
                  personas={character.data.personas}
                />
              </Tabs.Panel>
              <Tabs.Panel value="memory" className={styles.panel}>
                <CharacterMemoriesPanel
                  characterId={character.data.id}
                  memories={character.data.memories}
                />
              </Tabs.Panel>
              <Tabs.Panel value="posts" className={styles.panel}>
                <CharacterPostsPanel characterId={character.data.id} />
              </Tabs.Panel>
              <Tabs.Panel value="activity" className={styles.panel}>
                <CharacterActivityPanel characterId={character.data.id} />
              </Tabs.Panel>
              <Tabs.Panel value="visual" className={styles.panel}>
                <CharacterVisualPanel characterId={character.data.id} />
              </Tabs.Panel>
              <Tabs.Panel value="automation" className={styles.panel}>
                <CharacterAutomationPanel characterId={character.data.id} />
              </Tabs.Panel>
            </Tabs>
          </Paper>
        </Stack>
      ) : null}
    </DataPage>
  );
}
