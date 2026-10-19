import { Button, Stack, Text } from "@mantine/core";
import { ArrowLeft } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { DataPage } from "../../shared/ui/DataPage";
import { CharacterReferenceLinksPanel } from "./CharacterReferenceLinksPanel";
import { fetchCharacter } from "./api";

export function CharacterSnsDetailPage() {
  const { characterId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const character = useQuery({
    queryKey: ["character", characterId],
    queryFn: () => fetchCharacter(characterId!),
    enabled: Boolean(characterId),
  });

  if (!characterId) return <Navigate to="/sns-references" replace />;

  return (
    <DataPage
      title={
        character.data
          ? `${character.data.displayName}의 SNS 레퍼런스`
          : "SNS 레퍼런스 상세"
      }
      isPending={character.isPending}
      error={character.error}
      actions={
        <Button
          variant="default"
          leftSection={<ArrowLeft size={16} aria-hidden />}
          disabled={busy}
          onClick={() =>
            navigate(`/sns-references${location.search}`, {
              state: location.state,
            })
          }
        >
          목록으로
        </Button>
      }
    >
      {character.data ? (
        <Stack gap="md">
          <Text size="sm" c="ink.6">
            @{character.data.publicId}
          </Text>
          <CharacterReferenceLinksPanel
            key={characterId}
            characterId={characterId}
            title="연결된 링크"
            headingOrder={2}
            onBusyChange={setBusy}
          />
        </Stack>
      ) : null}
    </DataPage>
  );
}
