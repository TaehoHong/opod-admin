import { Button, Stack, Tabs, Text } from "@mantine/core";
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
          <Text size="sm" c="dimmed">
            @{character.data.publicId} · {character.data.status}
          </Text>
          <Tabs defaultValue="profile">
            <Tabs.List>
              <Tabs.Tab value="profile">프로필</Tabs.Tab>
              <Tabs.Tab value="personas">페르소나</Tabs.Tab>
              <Tabs.Tab value="memory">메모리</Tabs.Tab>
              <Tabs.Tab value="posts">게시글</Tabs.Tab>
              <Tabs.Tab value="activity">활동</Tabs.Tab>
              <Tabs.Tab value="visual">비주얼</Tabs.Tab>
              <Tabs.Tab value="automation">자동화</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="profile" pt="md">
              <CharacterProfilePanel
                key={character.data.id}
                character={character.data}
              />
            </Tabs.Panel>
            <Tabs.Panel value="personas" pt="md">
              <CharacterPersonasPanel
                characterId={character.data.id}
                personas={character.data.personas}
              />
            </Tabs.Panel>
            <Tabs.Panel value="memory" pt="md">
              <CharacterMemoriesPanel
                characterId={character.data.id}
                memories={character.data.memories}
              />
            </Tabs.Panel>
            <Tabs.Panel value="posts" pt="md">
              <CharacterPostsPanel characterId={character.data.id} />
            </Tabs.Panel>
            <Tabs.Panel value="activity" pt="md">
              <CharacterActivityPanel characterId={character.data.id} />
            </Tabs.Panel>
            <Tabs.Panel value="visual" pt="md">
              <CharacterVisualPanel characterId={character.data.id} />
            </Tabs.Panel>
            <Tabs.Panel value="automation" pt="md">
              <CharacterAutomationPanel characterId={character.data.id} />
            </Tabs.Panel>
          </Tabs>
        </Stack>
      ) : null}
    </DataPage>
  );
}
