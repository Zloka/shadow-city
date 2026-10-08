import { Box, HStack, Text } from '@chakra-ui/react'
import { Sun } from 'lucide-react'
import { Panel } from './Panel'

/** Shown while the first area loads, so the app never opens on an empty map. */
export function LoadingOverlay() {
  return (
    <Panel top="50%" left="50%" transform="translate(-50%, -50%)" px="6" py="4" pointerEvents="none">
      <HStack gap="3">
        <Box color="orange.400" animation="spin 6s linear infinite">
          <Sun size={28} />
        </Box>
        <Box>
          <Text fontWeight="700">Casting shadows…</Text>
          <Text textStyle="xs" color="fg.muted">
            Loading buildings and places from OpenStreetMap
          </Text>
        </Box>
      </HStack>
    </Panel>
  )
}
