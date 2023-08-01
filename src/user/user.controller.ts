import { Controller, Post, Get, Body } from '@nestjs/common'

@Controller('users')
export class UserController {
  constructor() {}

  @Get()
  async findAll() {
    return 'This action returns all users'
  }

  @Post()
  async create(@Body() user: any) {
    return user
  }


}
