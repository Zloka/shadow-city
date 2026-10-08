import { Box, Button, CloseButton, Dialog, HStack, Portal, SimpleGrid, Stack, Text } from '@chakra-ui/react'
import { Hand, MapPin, MousePointerClick, Search, Share2, Sun } from 'lucide-react'
import { Logo } from './Logo'

const STEPS = [
  { icon: Hand, title: 'Move the sun', text: 'Drag the time slider or play a day to watch real shadows sweep the streets.' },
  { icon: MousePointerClick, title: 'Tap a place', text: 'See when a bench, terrace or beach gets sun through the day.' },
  { icon: Share2, title: 'Share the moment', text: 'Send a link to the exact spot and time, like a sunny terrace at 17:30.' },
]

type WelcomeProps = {
  open: boolean
  onFindSun: () => void
  onExplore: () => void
  onSearch: () => void
}

export function Welcome({ open, onFindSun, onExplore, onSearch }: WelcomeProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={({ open }) => !open && onExplore()}
      placement="center"
      size="lg"
      motionPreset="slide-in-bottom"
    >
      <Portal>
        <Dialog.Backdrop bg="rgba(15, 23, 42, 0.45)" backdropFilter="blur(2px)" />
        <Dialog.Positioner px="4">
          <Dialog.Content borderRadius="2xl" overflow="hidden">
            <Box
              px="8"
              pt="8"
              pb="6"
              color="white"
              bgImage="linear-gradient(135deg, #1e2747 0%, #3b3f72 55%, #f6ad55 130%)"
            >
              <HStack gap="3" mb="4">
                <Logo size={36} />
                <Text fontWeight="800" textStyle="xl" letterSpacing="-0.02em">
                  Shadow City
                </Text>
              </HStack>
              <Dialog.Title textStyle="3xl" fontWeight="800" lineHeight="1.15" letterSpacing="-0.02em">
                See your city from the sun's point of view.
              </Dialog.Title>
              <Text mt="3" color="whiteAlpha.800">
                Real shadows of every building, for any moment of any day — and the benches, terraces
                and beaches that are in the sun right now.
              </Text>
            </Box>

            <Dialog.Body px="8" py="6">
              <Stack gap="6">
                <Stack gap="2">
                  <Button size="lg" colorPalette="yellow" borderRadius="xl" onClick={onFindSun}>
                    <MapPin /> Find sun near me
                  </Button>
                  <HStack gap="2">
                    <Button flex="1" variant="outline" borderRadius="xl" onClick={onExplore}>
                      <Sun /> Explore Helsinki
                    </Button>
                    <Button flex="1" variant="outline" borderRadius="xl" onClick={onSearch}>
                      <Search /> Search a place
                    </Button>
                  </HStack>
                </Stack>

                <SimpleGrid columns={{ base: 1, sm: 3 }} gap="4">
                  {STEPS.map(({ icon: Icon, title, text }) => (
                    <Stack key={title} gap="1">
                      <Box color="orange.500">
                        <Icon size={20} />
                      </Box>
                      <Text fontWeight="700" textStyle="sm">
                        {title}
                      </Text>
                      <Text textStyle="xs" color="fg.muted">
                        {text}
                      </Text>
                    </Stack>
                  ))}
                </SimpleGrid>
              </Stack>
            </Dialog.Body>

            <Dialog.CloseTrigger asChild top="3" insetEnd="3">
              <CloseButton size="sm" color="white" _hover={{ bg: 'whiteAlpha.200' }} />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}
