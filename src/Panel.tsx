import { Box, type BoxProps } from '@chakra-ui/react'

/** A frosted-glass card floating over the map; every overlay uses it so they read as one design. */
export function Panel(props: BoxProps) {
  return (
    <Box
      position="absolute"
      zIndex="10"
      bg="rgba(255, 255, 255, 0.82)"
      backdropFilter="blur(16px) saturate(1.6)"
      borderWidth="1px"
      borderColor="rgba(255, 255, 255, 0.7)"
      borderRadius="2xl"
      boxShadow="0 12px 32px -12px rgba(15, 23, 42, 0.3), 0 2px 6px rgba(15, 23, 42, 0.06)"
      {...props}
    />
  )
}
